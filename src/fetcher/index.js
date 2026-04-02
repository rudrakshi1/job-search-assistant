import { fetchAdzunaJobs } from './adzuna.js';
import { fetchNaukriJobs } from './naukri.js';
import { fetchLinkedInJobs } from './linkedin-jobs.js';
import { fetchLinkedInPosts } from './linkedin-posts.js';
export { getPinnedJobs } from './pinned.js';

export async function fetchAllJobs() {
  console.log('\n📡 Fetching real jobs from all sources...\n');
  const results = { adzuna: [], naukri: [], linkedin: [], linkedinPosts: [], errors: [] };

  // Run Adzuna and Naukri in parallel (no browser needed)
  console.log('── Phase A: API + HTTP scrapers (fast) ──');
  const [adzuna, naukri] = await Promise.allSettled([
    fetchAdzunaJobs(),
    fetchNaukriJobs(),
  ]);

  if (adzuna.status === 'fulfilled') results.adzuna = adzuna.value;
  else { console.error('Adzuna failed:', adzuna.reason?.message); results.errors.push('adzuna'); }

  if (naukri.status === 'fulfilled') results.naukri = naukri.value;
  else { console.error('Naukri failed:', naukri.reason?.message); results.errors.push('naukri'); }

  // Run LinkedIn scrapers sequentially (both use browser)
  console.log('\n── Phase B: LinkedIn scrapers (browser) ──');
  try {
    results.linkedin = await fetchLinkedInJobs();
  } catch (err) {
    console.error('LinkedIn jobs failed:', err.message);
    results.errors.push('linkedin-jobs');
  }

  try {
    results.linkedinPosts = await fetchLinkedInPosts();
  } catch (err) {
    console.error('LinkedIn posts failed:', err.message);
    results.errors.push('linkedin-posts');
  }

  const all = deduplicateJobs([
    ...results.adzuna,
    ...results.naukri,
    ...results.linkedin,
    ...results.linkedinPosts,
  ]);

  console.log(`\n✅ Total real jobs fetched: ${all.length}`);
  console.log(`   Adzuna: ${results.adzuna.length} | Naukri: ${results.naukri.length} | LinkedIn jobs: ${results.linkedin.length} | LinkedIn posts: ${results.linkedinPosts.length}`);
  if (results.errors.length) console.log(`   ⚠ Failed sources: ${results.errors.join(', ')}`);
  console.log('');

  return all;
}

function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = `${(job.title||'').toLowerCase().replace(/\s+/g,'')}__${(job.company||'').toLowerCase().replace(/\s+/g,'')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
