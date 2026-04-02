import axios from 'axios';
import 'dotenv/config';

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs/in/search/1';

const QUERIES = [
  "chief of staff",
  "founder office",
  "strategy operations",
  "entrepreneur residence",
  "venture capital analyst",
  "vc analyst associate india",
];

export async function fetchAdzunaJobs() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || appId === 'your_adzuna_app_id') {
    console.log('  ⚠ Adzuna key not set — skipping');
    return [];
  }

  const jobs = [];
  const seen = new Set();

  for (const query of QUERIES) {
    try {
      console.log(`  Adzuna: searching "${query}"...`);
      const url = `${ADZUNA_BASE}?app_id=${appId}&app_key=${appKey}&results_per_page=10&what=${encodeURIComponent(query)}&content-type=application/json`;

      const res = await axios.get(url, { timeout: 10000 });

      for (const r of (res.data?.results || [])) {
        const key = `${r.title}__${r.company?.display_name}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push({
          id: `adzuna-${r.id}`,
          title: r.title,
          company: r.company?.display_name || 'Unknown',
          location: r.location?.display_name || 'India',
          sector: r.category?.label || 'Unknown',
          source: 'adzuna',
          url: r.redirect_url,
          jd_text: r.description,
          salary_min: r.salary_min || null,
          salary_max: r.salary_max || null,
          salary_stated: r.salary_min ? true : false,
          posted_date: r.created,
        });
      }
      await sleep(800);
    } catch (err) {
      console.error(`  Adzuna error for "${query}":`, err.message);
    }
  }

  console.log(`  ✓ Adzuna: ${jobs.length} real jobs fetched`);
  return jobs;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
