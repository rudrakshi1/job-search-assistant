import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCoverEmail, sendViaGmailMCP } from '../automation/gmail-action.js';
import { enrichCompany, buildEnrichmentSummary } from '../fetcher/enrichment.js';
import { createInterviewPrepEvent } from '../automation/calendar-action.js';
import { prefillLinkedInEasyApply, submitLinkedInApplication, discardLinkedInSession } from '../automation/linkedin-apply.js';
import { getAllJobs, getJobById, getJobByTitleCompany, getExistingScore, updateJobStage, markAlertRead, getUnreadAlerts, addToWatchlist, upsertJob, getStats } from '../tracker/db.js';
import { scoreJob } from '../scorer/index.js';
import { fetchAllJobs, getPinnedJobs } from '../fetcher/index.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/jobs', async (req, res) => {
  try {
    const [jobList, unreadAlerts] = await Promise.all([getAllJobs(), getUnreadAlerts()]);
    res.json({ jobs: jobList, alerts: unreadAlerts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/jobs/:id/stage', async (req, res) => {
  try {
    await updateJobStage(req.params.id, req.body.stage);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fetch', async (req, res) => {
  res.json({ ok: true, message: 'Fetch started — jobs scoring in background' });
  try {
    const [fetched, pinned] = await Promise.all([fetchAllJobs(), getPinnedJobs()]);
    const allJobs = [...pinned, ...fetched];
    console.log(`\n📡 Fetched ${allJobs.length} jobs — scoring new ones...\n`);

    const userStages = ['applied', 'awaiting', 'round1', 'round2', 'offer', 'rejected'];
    let scored = 0, skipped = 0, discarded = 0;

    for (const job of allJobs) {
      const key = (job._id || (job.title + '__' + job.company).toLowerCase().replace(/[^a-z0-9]+/g, '-'));

      // Triple dedup: by _id, by title+company key, and by DB score lookup
      const existingById = await getJobById(key);
      const existing = existingById || await getExistingScore(job.title, job.company);

      // Skip if already scored — never re-score regardless of source
      if (existing && existing.score > 0) {
        console.log(`  ↩ Already scored: ${job.company} ${existing.score}/100 [${existing.stage||'discovered'}]`);
        skipped++;
        continue;
      }

      // Skip if user has moved this job to an active stage
      if (existing && userStages.includes(existing.stage)) {
        console.log(`  ↩ Keeping ${job.company} [${existing.stage}] — user-set stage preserved`);
        skipped++;
        continue;
      }

      // Enrich company first (uses cache — each company only enriched once)
      console.log(`  Enriching: ${job.company}...`);
      const enrichment = await enrichCompany(job.company);
      const { glassdoorSummary, founderSummary, flags: enrichFlags } = buildEnrichmentSummary(enrichment);

      // Add enrichment to job context for scorer
      const enrichedJob = {
        ...job,
        company_intel: glassdoorSummary || job.company_intel,
        ceo_brief: founderSummary || job.ceo_brief,
      };

      console.log(`  Scoring: ${job.title} @ ${job.company}`);
      const result = await scoreJob(enrichedJob);

      if (result.discard) {
        console.log(`  ✕ ${result.reason}`);
        discarded++;
        if (!existing) {
          await upsertJob({
            ...job,
            score: 0,
            score_breakdown: null,
            is_top_tier: false,
            is_vc_role: false,
            flagged: true,
            flag_reasons: JSON.stringify({ discardReason: result.reason }),
            ceo_brief: null,
            company_intel: null,
            bucket: 'reject',
            stage: 'rejected',
          });
        }
        continue;
      }

      await upsertJob({
        ...job,
        score: result.score || 0,
        score_breakdown: result.breakdown ? JSON.stringify(result.breakdown) : null,
        is_top_tier: result.isTopTier || false,
        is_vc_role: result.isVC || false,
        flagged: result.flags ? Object.values(result.flags).some(Boolean) : false,
        flag_reasons: result.flags ? JSON.stringify(result.flags) : null,
        ceo_brief: result.founderBrief || null,
        company_intel: result.companyIntel || null,
        glassdoor_insights: result.glassdoorInsights || null,
        key_factors: result.keyFactors ? JSON.stringify(result.keyFactors) : null,
        why_interested: result.whyInterested || null,
        poster_info: result.posterInfo ? JSON.stringify(result.posterInfo) : null,
        bucket: result.bucket?.bucket || 'auto',
        one_liner: result.oneLiner || null,
      });
      scored++;
      const bucket = result.bucket || {};
      console.log(`  ✓ ${job.company}: ${result.score}/100 [${bucket.label||''}] — ${result.oneLiner || ''}`);
    }
    console.log(`\n✅ Done — scored: ${scored} | skipped (already scored): ${skipped} | discarded: ${discarded}\n`);
  } catch (err) {
    console.error('Fetch/score error:', err.message);
  }
});

app.post('/api/alerts/:id/read', async (req, res) => {
  try { await markAlertRead(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/watchlist', async (req, res) => {
  try { await addToWatchlist(req.body.company); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stats', async (req, res) => {
  try { res.json(await getStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Clear non-pinned jobs for fresh fetch
app.post('/api/clear', async (req, res) => {
  try {
    const all = await getAllJobs();
    const Datastore = (await import('@seald-io/nedb')).default;
    const path = (await import('path')).default;
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const db = new Datastore({ filename: path.join(__dirname, '../../data/jobs.db'), autoload: true });
    await new Promise((res, rej) => db.remove({ pinned: { $ne: true } }, { multi: true }, (err, n) => err ? rej(err) : res(n)));
    res.json({ ok: true, cleared: all.filter(j => !j.pinned).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ACTION 1: Generate + send cover email via Gmail MCP
app.post('/api/jobs/:id/cover-email', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    console.log(`\n📧 Generating cover email for ${job.company}...`);
    const { subject, body, fallback } = await generateCoverEmail(job, {
      score: job.score,
      companyIntel: job.company_intel,
      founderBrief: job.ceo_brief,
      whyInterested: job.why_interested,
    });

    // Try to send/draft via Gmail MCP
    let sendResult = { ok: false, authError: false };
    if (req.body.sendAsDraft || req.body.toEmail) {
      console.log(`  Sending via Gmail MCP...`);
      sendResult = await sendViaGmailMCP(subject, body, req.body.toEmail);
    }

    console.log(`  ✓ Cover email generated for ${job.company}${sendResult.ok ? ' and sent' : ''}`);
    res.json({
      ok: true, subject, body,
      sent: sendResult.ok,
      authError: sendResult.authError,
      fallback: !!fallback,
      gmailResponse: sendResult.response,
      note: sendResult.authError ? 'Copy the email above to send manually — Gmail MCP auth not available in agent context' : null,
    });
  } catch (err) {
    console.error('Cover email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ACTION 2: Create interview prep Calendar event via Google Calendar MCP
app.post('/api/jobs/:id/calendar-event', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    console.log(`\n📅 Creating calendar event for ${job.company}...`);
    const result = await createInterviewPrepEvent(job, {
      score: job.score,
      companyIntel: job.company_intel,
      founderBrief: job.ceo_brief,
      whyInterested: job.why_interested,
    });

    if (result.ok) {
      console.log(`  ✓ Calendar event created: ${result.eventTitle}`);
    } else if (result.authError) {
      console.log(`  ⚠ Calendar MCP auth failed — returning event details for manual creation`);
    }

    res.json(result);
  } catch (err) {
    console.error('Calendar event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ACTION 3: LinkedIn Easy Apply — prefill + pause for review
app.post('/api/jobs/:id/linkedin-apply', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.url || !job.url.includes('linkedin.com')) {
      return res.status(400).json({ error: 'No LinkedIn URL for this job', url: job.url });
    }

    console.log(`\n🔗 Starting LinkedIn Easy Apply for ${job.company}...`);
    const result = await prefillLinkedInEasyApply(job.url, req.params.id, job.company, job.score, job);

    // Update job status
    await upsertJob({ ...job, apply_status: result.status, apply_fields: JSON.stringify(result.fieldValues) });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit LinkedIn application after user review
app.post('/api/jobs/:id/linkedin-submit', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const result = await submitLinkedInApplication(req.params.id);
    if (result.ok) {
      await upsertJob({ ...job, apply_status: 'applied', stage: 'applied', applied_at: new Date().toISOString() });
      console.log(`  ✓ Applied to ${job.company} via LinkedIn`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discard LinkedIn session
app.post('/api/jobs/:id/linkedin-discard', async (req, res) => {
  try {
    await discardLinkedInSession();
    const job = await getJobById(req.params.id);
    if (job) await upsertJob({ ...job, apply_status: 'skipped' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test actions page
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/test-actions.html'));
});

export function startDashboard() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🌐 Dashboard → http://localhost:${PORT}\n`);
  });
}
