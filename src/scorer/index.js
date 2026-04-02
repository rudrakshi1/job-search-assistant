import axios from 'axios';
import { CANDIDATE, TOP_TIER_COMPANIES, TOP_TIER_INVESTORS, HARD_FILTERS, STORY_BANK } from '../../config/profile.js';
import 'dotenv/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Key rotation — alternate between two keys to double effective rate limit
const GROQ_KEYS = [process.env.GROQ_API_KEY].filter(Boolean); // Single key
let keyIndex = 0;
function getNextKey() { const k = GROQ_KEYS[keyIndex % GROQ_KEYS.length]; keyIndex++; return k; }

// Cache to prevent re-scoring same company+role
const scoreCache = new Map(); // In-memory cache for current session
// DB cache used for cross-restart persistence (via server.js skip logic)

// With 2 keys rotating: 1.5s delay = effectively 3s per key = 20 RPM per key (safe under 30)
let lastCallTime = 0;
const MIN_DELAY_MS = 5000; // 5s between calls = 12 RPM, well under 30 RPM limit

async function callGroq(prompt) {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_DELAY_MS) await sleep(MIN_DELAY_MS - elapsed);
  lastCallTime = Date.now();

  const key = getNextKey();

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await axios.post(GROQ_URL, {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1200,
      }, {
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      return res.data?.choices?.[0]?.message?.content || '';
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        // On rate limit, try the other key immediately
        const otherKey = GROQ_KEYS.find(k => k !== key);
        if (otherKey && attempt === 1) {
          console.log(`  ⏳ Key ${keyIndex % GROQ_KEYS.length + 1} rate limited — switching to other key...`);
          try {
            const res2 = await axios.post(GROQ_URL, {
              model: GROQ_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
              max_tokens: 1200,
            }, {
              headers: { 'Authorization': `Bearer ${otherKey}`, 'Content-Type': 'application/json' },
              timeout: 30000,
            });
            return res2.data?.choices?.[0]?.message?.content || '';
          } catch {}
        }
        const wait = attempt * 15000;
        console.log(`  ⏳ Rate limited — waiting ${wait/1000}s (attempt ${attempt}/4)...`);
        await sleep(wait);
        lastCallTime = Date.now();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// BUCKET SYSTEM
// 0-44:  Reject — do not apply
// 45-59: Auto-apply (standard fields only, no review needed)
// 60-79: Review — pre-fill, human approves open-text before submit
// 80+:   High priority flag — always human review, top opportunity
export function getBucket(score, isTopTier, isVC) {
  if (isVC) return { bucket: 'vc', label: 'Manual — VC', action: 'manual', color: '#6ba3d6' };
  if (isTopTier) return { bucket: 'toptier', label: 'Review all', action: 'review_all', color: '#9b8ec4' };
  if (score >= 80) return { bucket: 'high', label: '🔥 High priority', action: 'review_all', color: '#c9a96e' };
  if (score >= 60) return { bucket: 'review', label: 'Review text', action: 'review_open_text', color: '#e8a844' };
  if (score >= 45) return { bucket: 'auto', label: 'Auto-apply', action: 'auto_submit', color: '#4db87a' };
  return { bucket: 'reject', label: 'Skip', action: 'reject', color: '#6e6c66' };
}

export async function scoreJob(job) {
  // Cache check — same company + same title = same score
  const cacheKey = `${(job.company||'').toLowerCase()}__${(job.title||'').toLowerCase()}`;
  if (scoreCache.has(cacheKey)) {
    console.log(`  ↩ Using cached score for ${job.company}`);
    return { ...scoreCache.get(cacheKey), fromCache: true };
  }

  const hardFilter = checkHardFilters(job);
  if (hardFilter.discard) {
    return { score: 0, discard: true, reason: hardFilter.reason, breakdown: {}, bucket: getBucket(0, false, false) };
  }

  const isTopTier = checkTopTier(job);
  const isVC = checkVCRole(job);

  // Enrich with Glassdoor + founder profile
  let glassdoorData = null, founderData = null;
  try {
  } catch {}

  // Use enrichment data from job context (pre-enriched by server.js)
  const gFlags = {};
  const prompt = buildScoringPrompt(job, null, null, null);

  try {
    const text = await callGroq(prompt);
    const parsed = parseScoreResponse(text, job);
    if (parsed.flags) Object.assign(parsed.flags, gFlags);

    // Enrich with stored data from job context
    if (job.ceo_brief) parsed.founderBrief = job.ceo_brief + (parsed.founderBrief ? '\n\nAI: ' + parsed.founderBrief : '');
    if (job.company_intel) parsed.companyIntel = job.company_intel + (parsed.companyIntel ? '\n\n' + parsed.companyIntel : '');

    // Add bucket
    parsed.bucket = getBucket(parsed.score || 0, isTopTier, isVC);

    // Add scoring factors
    parsed.glassdoorData = glassdoorData;
    parsed.founderData = founderData;

    const result = { ...parsed, isTopTier, isVC, discard: false };

    // Cache result
    scoreCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error('  Scoring error:', err.message);
    return { score: 0, discard: false, breakdown: {}, flags: {}, founderBrief: null, companyIntel: null, oneLiner: 'Scoring failed', bucket: getBucket(0, false, false), error: err.message };
  }
}

function checkHardFilters(job) {
  if (job.salary_stated && job.salary_min && job.salary_min < HARD_FILTERS.minBaseSalary) {
    return { discard: true, reason: `Base ${(job.salary_min/100000).toFixed(0)}L below 30L hard floor` };
  }
  const title = (job.title || '').toLowerCase();
  const jd = (job.jd_text || '').toLowerCase();
  if ((title.includes('sales') || title.includes('business development')) &&
      !title.includes('strategy') && !title.includes('chief') &&
      (jd.includes('quota') || (jd.includes('targets') && jd.includes('revenue')))) {
    return { discard: true, reason: 'Pure sales/quota role' };
  }
  return { discard: false };
}

function checkTopTier(job) {
  const co = (job.company || '').toLowerCase();
  const jd = (job.jd_text || '').toLowerCase();
  return TOP_TIER_COMPANIES.some(c => co.includes(c.toLowerCase())) ||
    TOP_TIER_INVESTORS.some(i => jd.includes(i.toLowerCase()));
}

function checkVCRole(job) {
  const t = (job.title || '').toLowerCase();
  const co = (job.company || '').toLowerCase();
  const jd = (job.jd_text || '').toLowerCase();
  return (t.includes('analyst') || t.includes('associate') || t.includes('investor')) &&
    (co.includes('venture') || co.includes(' vc') || co.includes('capital') || co.includes('fund') ||
     jd.includes('portfolio companies') || jd.includes('investment thesis'));
}

function buildScoringPrompt(job, glassdoorSummary, founderSummary, glassdoorData) {

  const candidateBg = CANDIDATE.background || 'Experienced professional';
  const targetRoles = (CANDIDATE.targetRoles || ['Founder Office','CoS','EIR','Strategy']).join(', ');
  const targetSectors = (CANDIDATE.targetSectors || ['AI','fintech','supply chain','consumer']).join(', ');
  const minSalaryL = Math.round((HARD_FILTERS.minBaseSalary||3000000)/100000);

  return `Score this job for a candidate: ${candidateBg}. Target roles: ${targetRoles}. Target sectors: ${targetSectors} (max score). Min base salary: ${minSalaryL}L hard floor. Bangalore +5pts. Key: founder domain credibility matters — marketing/ads background building unrelated sector = dealbreaker.
LOCATION: Bangalore +5pts, NCR/Remote neutral.
KEY SIGNAL: Rejected Goodscore — founder had Google Ads background building fintech = no domain credibility. Founder must be credible in their own domain.

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'India'}
Sector: ${job.sector || 'Unknown'}
Salary: ${job.salary_min ? `${(job.salary_min/100000).toFixed(0)}L` : 'Not stated'}
${glassdoorSummary ? 'GLASSDOOR SUMMARY: ' + glassdoorSummary : ''}
${founderSummary ? 'FOUNDER PROFILE: ' + founderSummary : ''}
JD: ${(job.jd_text || '').slice(0, 900)}

SCORE 0-100 across 7 dimensions. For each dimension also provide 2-3 KEY FACTORS that influenced the score (specific, not generic).

Reply ONLY with valid JSON — no markdown, no explanation, just raw JSON:
{
  "score": 75,
  "breakdown": {
    "founderLearning": 20,
    "roleOwnership": 15,
    "sectorFit": 14,
    "alumniPeerQuality": 9,
    "cultureStabilityWLB": 9,
    "investorBacking": 5,
    "ctcComp": 3,
    "locationModifier": 0
  },
  "keyFactors": {
    "founderLearning": "Founder has 10 years in fintech; known for giving autonomy to team; no micromanagement signals",
    "roleOwnership": "Direct access to CEO; P&L ownership mentioned; role involves cross-functional leadership",
    "sectorFit": "AI company aligns with target sector — full marks",
    "alumniPeerQuality": "IIT/IIM alumni visible on LinkedIn; previous chief of staff went to HBS",
    "cultureStabilityWLB": "Glassdoor 4.1/5; no layoff signals; Series B funded 8 months ago; WLB 3.8/5",
    "investorBacking": "Backed by Sequoia and Accel; strong tier-1 signal",
    "ctcComp": "Salary not stated; likely market rate given stage"
  },
  "flags": {
    "paycut": false,
    "belowUpgradeThreshold": false,
    "wlbRisk": false,
    "stabilityRisk": false,
    "firstTimeFounder": false,
    "ctcUnconfirmed": true,
    "experienceMismatch": false
  },
  "founderBrief": "2-3 sentences on founder credibility, domain fit, management style",
  "glassdoorInsights": "Specific Glassdoor insights: most common terms in reviews, CEO background and education if known, company age, customer reviews if product company",
  "whyInterested": "3 sentences why the candidate would want this role, in first person",
  "roleStory": "founders_office",
  "oneLiner": "one punchy sentence summarising fit or miss",
  "companyIntel": "funding stage, investors, headcount signals, company age, key recent news",
  "posterInfo": "name and title of person who posted this job if available from JD context, else null"
}`;
}

function parseScoreResponse(text, job) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match ? match[0] : text.trim());
    const loc = (job.location || '').toLowerCase();
    const locMod = (loc.includes('bengaluru') || loc.includes('bangalore')) ? 5 : 0;
    data.breakdown = data.breakdown || {};
    data.breakdown.locationModifier = locMod;
    data.score = Math.min(100, (data.score || 0) + locMod);
    return data;
  } catch {
    return { score: 50, breakdown: {}, flags: {}, keyFactors: {}, founderBrief: null, whyInterested: '', roleStory: 'founders_office', oneLiner: 'Parse failed', companyIntel: '', glassdoorInsights: '', posterInfo: null };
  }
}

export function getAutoSubmitRule(score, isTopTier, isVC) {
  return getBucket(score, isTopTier, isVC);
}

export function getWhyInterestedAnswer(job, result) {
  if (result.whyInterested?.length > 50) return result.whyInterested;
  return STORY_BANK[result.roleStory || 'founders_office']?.slice(0, 300) || '';
}
