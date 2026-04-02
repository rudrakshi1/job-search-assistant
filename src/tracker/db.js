import Datastore from '@seald-io/nedb';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const jobs = new Datastore({ filename: path.join(DATA_DIR, 'jobs.db'), autoload: true });
const alertsDB = new Datastore({ filename: path.join(DATA_DIR, 'alerts.db'), autoload: true });
const watchlistDB = new Datastore({ filename: path.join(DATA_DIR, 'watchlist.db'), autoload: true });

watchlistDB.ensureIndex({ fieldName: 'company', unique: true });

const dbFind = (db, query, sort = {}) => new Promise((res, rej) =>
  db.find(query).sort(sort).exec((err, docs) => err ? rej(err) : res(docs)));

const dbFindOne = (db, query) => new Promise((res, rej) =>
  db.findOne(query, (err, doc) => err ? rej(err) : res(doc)));

const dbInsert = (db, doc) => new Promise((res, rej) =>
  db.insert(doc, (err, d) => err ? rej(err) : res(d)));

const dbUpdate = (db, query, upd, opts = {}) => new Promise((res, rej) =>
  db.update(query, upd, opts, (err, n) => err ? rej(err) : res(n)));

export async function initDB() {
  // Remove any duplicate Leena AI EIR records (old format)
  const all = await dbFind(jobs, { company: 'Leena AI' });
  if (all.length > 1) {
    // Keep the pinned one, remove duplicates
    const toRemove = all.filter(j => j._id !== 'leena-ai-eir-pinned');
    for (const j of toRemove) {
      await new Promise((res, rej) => jobs.remove({ _id: j._id }, {}, (err, n) => err ? rej(err) : res(n)));
    }
    console.log(`✓ Removed ${toRemove.length} duplicate Leena AI record(s)`);
  }

  const existing = await dbFindOne(jobs, { _id: 'leena-ai-eir-pinned' });
  if (!existing) {
    await dbInsert(jobs, {
      _id: 'leena-ai-eir-pinned',
      jobKey: 'leena-ai-eir-pinned',
      title: 'Entrepreneur in Residence (EIR)',
      company: 'Leena AI',
      location: 'New York / Remote',
      sector: 'AI',
      source: 'assignment',
      url: 'https://www.leena.ai',
      jd_text: 'Leena AI is a leader in Agentic AI for the enterprise. $40M+ raised from Greycroft, Bessemer, B Capital, Y Combinator. 500+ global enterprises, 20M+ employees. Role: EIR — Special Ops leader. 12-18 month residency to Department Head or Director. Two archetypes: Systems Architect (Data & Automation) and Growth Accelerator (Execution & People). Requirements: 2-4 years consulting/IB/startup. Bias for action. Analytical rigour. No ego.',
      salary_min: null, salary_max: null, salary_stated: false,
      stage: 'discovered', pinned: true, is_top_tier: true, is_vc_role: false,
      score: 0, score_breakdown: null, flagged: false, flag_reasons: null,
      ceo_brief: null, company_intel: null,
      auto_applied: false, discovered_at: new Date().toISOString(),
    });
    console.log('✓ Leena AI EIR seeded as pinned role');
  }
}

export async function upsertJob(job) {
  const key = job._id || (job.title + '__' + job.company).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = await dbFindOne(jobs, { _id: key });
  if (existing) {
    const newScore = job.score || 0;
    const keepScore = existing.score > 0 && newScore === 0;
    await dbUpdate(jobs, { _id: key }, { $set: {
      score: keepScore ? existing.score : newScore,
      score_breakdown: keepScore ? existing.score_breakdown : job.score_breakdown,
      is_top_tier: job.is_top_tier,
      is_vc_role: job.is_vc_role,
      flagged: job.flagged,
      flag_reasons: job.flag_reasons,
      ceo_brief: job.ceo_brief || existing.ceo_brief,
      company_intel: job.company_intel || existing.company_intel,
      glassdoor_insights: job.glassdoor_insights || existing.glassdoor_insights,
      key_factors: job.key_factors || existing.key_factors,
      why_interested: job.why_interested || existing.why_interested,
      poster_info: job.poster_info || existing.poster_info,
      bucket: job.bucket || existing.bucket,
      one_liner: job.one_liner || existing.one_liner,
      jd_text: job.jd_text || existing.jd_text,
    }});
  } else {
    await dbInsert(jobs, {
      _id: key,
      jobKey: key,
      ...job,
      stage: job.stage || 'discovered',
      discovered_at: new Date().toISOString(),
    });
  }
  return key;
}

export async function getAllJobs(filter = {}) {
  let query = {};
  if (filter.stage) query.stage = filter.stage;
  if (filter.pinned) query.pinned = true;
  const all = await dbFind(jobs, query);
  return all.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.score || 0) - (a.score || 0));
}

export async function getJobById(id) {
  // Primary lookup by _id
  const byId = await dbFindOne(jobs, { _id: id });
  if (byId) return byId;
  // Fallback: the id might be a title__company key, try direct match
  return null;
}

// Lookup by normalised title+company key (prevents double-scoring same role)
export async function getJobByTitleCompany(title, company) {
  const key = (title + '__' + company).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const byKey = await dbFindOne(jobs, { _id: key });
  if (byKey) return byKey;
  // Also search by title+company fields directly
  return dbFindOne(jobs, { title: { $regex: new RegExp(title.slice(0,20), 'i') }, company: { $regex: new RegExp(company.slice(0,15), 'i') } });
}

export async function updateJobStage(jobId, stage) {
  return dbUpdate(jobs, { _id: jobId }, { $set: { stage } });
}

export async function markApplied(jobId, platform, answersObj) {
  return dbUpdate(jobs, { _id: jobId }, { $set: {
    auto_applied: true, applied_at: new Date().toISOString(),
    platform, answers_given: JSON.stringify(answersObj), stage: 'applied',
  }});
}

export async function addAlert(jobId, type, message) {
  return dbInsert(alertsDB, {
    job_id: jobId, type, message, read: false,
    created_at: new Date().toISOString(),
  });
}

export async function getUnreadAlerts() {
  const unread = await dbFind(alertsDB, { read: false }, { created_at: -1 });
  return Promise.all(unread.map(async a => {
    const job = await dbFindOne(jobs, { _id: a.job_id });
    return { ...a, title: job?.title, company: job?.company };
  }));
}

export async function markAlertRead(id) {
  return dbUpdate(alertsDB, { _id: id }, { $set: { read: true } });
}

export async function addToWatchlist(company) {
  try { await dbInsert(watchlistDB, { company, added_at: new Date().toISOString() }); } catch {}
}

export async function isOnWatchlist(company) {
  return !!(await dbFindOne(watchlistDB, { company }));
}

export async function getStats() {
  const all = await dbFind(jobs, {});
  const scored = all.filter(j => j.score > 0);
  const avgScore = scored.length ? Math.round(scored.reduce((s, j) => s + j.score, 0) / scored.length) : 0;
  return {
    total: all.length,
    applied: all.filter(j => j.stage === 'applied').length,
    interviewing: all.filter(j => ['round1','round2'].includes(j.stage)).length,
    offers: all.filter(j => j.stage === 'offer').length,
    avgScore,
    topRoles: all.sort((a,b) => (b.score||0)-(a.score||0)).slice(0,5).map(j => ({ title:j.title, company:j.company, score:j.score })),
  };
}

// Get jobs that haven't been scored yet (score = 0 and not pinned)
export async function getUnscoredJobs() {
  const all = await dbFind(jobs, { score: 0, pinned: { $ne: true } });
  return all;
}

// Check if a job with same company+title already has a score
export async function findSimilarScored(title, company) {
  const key = `${title}__${company}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = await dbFindOne(jobs, { _id: key, score: { $gt: 0 } });
  return existing;
}

// Persistent score cache — prevents re-scoring same company+title across restarts
export async function getExistingScore(title, company) {
  const key = (title + '__' + company).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Check by normalised key first
  const byKey = await dbFindOne(jobs, { _id: key });
  if (byKey && byKey.score > 0) return byKey;
  // Check by company+title fields (catches URL-keyed records from different sources)
  const byFields = await dbFindOne(jobs, {
    company: { $regex: new RegExp('^' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    title: { $regex: new RegExp('^' + title.slice(0,30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    score: { $gt: 0 }
  });
  return byFields || null;
}
