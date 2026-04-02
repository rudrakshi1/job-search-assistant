import { chromium } from 'playwright';

const LINKEDIN_SEARCHES = [
  { keywords: "founder's office", location: "Bengaluru, Karnataka, India" },
  { keywords: "chief of staff startup", location: "Bengaluru, Karnataka, India" },
  { keywords: "entrepreneur in residence", location: "India" },
  { keywords: "strategy operations startup", location: "Bengaluru, Karnataka, India" },
  { keywords: "chief of staff fintech", location: "Gurugram, Haryana, India" },
  { keywords: "founder office AI startup", location: "India" },
  { keywords: "EIR startup India", location: "India" },
];

export async function fetchLinkedInJobs() {
  const jobs = [];
  const seen = new Set();
  let browser;

  try {
    console.log('  LinkedIn: launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    for (const search of LINKEDIN_SEARCHES) {
      try {
        const page = await context.newPage();
        const encodedKeywords = encodeURIComponent(search.keywords);
        const encodedLocation = encodeURIComponent(search.location);
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodedKeywords}&location=${encodedLocation}&f_TPR=r604800&sortBy=DD`;

        console.log(`  LinkedIn jobs: "${search.keywords}" in ${search.location}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000);

        // Extract job cards from public LinkedIn jobs page
        const jobCards = await page.evaluate(() => {
          const cards = document.querySelectorAll('div.base-card, li.jobs-search-results__list-item, .job-search-card');
          const results = [];
          cards.forEach((card, i) => {
            if (i >= 6) return;
            const title = card.querySelector('h3.base-search-card__title, .job-result-card__title, h3')?.textContent?.trim();
            const company = card.querySelector('h4.base-search-card__subtitle, .job-result-card__subtitle, h4')?.textContent?.trim();
            const location = card.querySelector('.job-search-card__location, .job-result-card__location')?.textContent?.trim();
            const link = card.querySelector('a.base-card__full-link, a')?.href;
            const timePosted = card.querySelector('time')?.textContent?.trim();
            if (title && company) {
              results.push({ title, company, location, link, timePosted });
            }
          });
          return results;
        });

        for (const card of jobCards) {
          const key = `${card.title}__${card.company}`.toLowerCase().replace(/\s+/g, '');
          if (seen.has(key)) continue;
          seen.add(key);

          jobs.push({
            id: `linkedin-${key.slice(0, 40)}`,
            title: card.title,
            company: card.company,
            location: card.location || search.location,
            sector: 'Unknown',
            source: 'linkedin',
            url: card.link || 'https://linkedin.com/jobs',
            jd_text: `${card.title} at ${card.company}. Location: ${card.location || search.location}. Posted: ${card.timePosted || 'recently'}.`,
            salary_min: null,
            salary_max: null,
            salary_stated: false,
            posted_date: new Date().toISOString(),
          });
        }

        await page.close();
        await sleep(2000);
      } catch (err) {
        console.error(`  LinkedIn jobs error for "${search.keywords}":`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error('  LinkedIn scraper error:', err.message);
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`  ✓ LinkedIn jobs: ${jobs.length} real jobs fetched`);
  return jobs;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
