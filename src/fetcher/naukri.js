import axios from 'axios';
import * as cheerio from 'cheerio';

const NAUKRI_SEARCHES = [
  { query: "founders-office", location: "bangalore" },
  { query: "chief-of-staff", location: "bangalore" },
  { query: "strategy-operations", location: "bangalore" },
  { query: "founders-office", location: "gurugram" },
  { query: "chief-of-staff", location: "mumbai" },
  { query: "entrepreneur-in-residence", location: "india" },
];

export async function fetchNaukriJobs() {
  const jobs = [];
  const seen = new Set();

  for (const search of NAUKRI_SEARCHES) {
    try {
      console.log(`  Naukri: searching "${search.query}" in ${search.location}...`);
      const url = `https://www.naukri.com/${search.query}-jobs-in-${search.location}`;

      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(res.data);

      // Naukri job card selectors
      $('article.jobTuple, div.jobTuple, .cust-job-tuple').each((i, el) => {
        if (i >= 8) return false; // Max 8 per search

        const title = $(el).find('a.title, .jobTitle, a[class*="title"]').first().text().trim();
        const company = $(el).find('a.subTitle, .companyName, [class*="company"]').first().text().trim();
        const location = $(el).find('.location, .locWdth, [class*="location"]').first().text().trim() || search.location;
        const experience = $(el).find('.expwdth, [class*="exp"]').first().text().trim();
        const salary = $(el).find('.salary, [class*="salary"]').first().text().trim();
        const link = $(el).find('a.title, a[class*="title"]').attr('href') || '';
        const description = $(el).find('.job-description, .jd-desc, [class*="desc"]').first().text().trim();

        if (!title || !company) return;

        const key = `${title}__${company}`.toLowerCase().replace(/\s+/g, '');
        if (seen.has(key)) return;
        seen.add(key);

        // Parse salary if available
        let salaryMin = null;
        let salaryStated = false;
        if (salary && salary.includes('L')) {
          const match = salary.match(/(\d+)/);
          if (match) {
            salaryMin = parseInt(match[1]) * 100000;
            salaryStated = true;
          }
        }

        jobs.push({
          id: `naukri-${key.slice(0, 40)}`,
          title,
          company,
          location: location || search.location,
          sector: guessSector(title + ' ' + description),
          source: 'naukri',
          url: link.startsWith('http') ? link : `https://www.naukri.com${link}`,
          jd_text: description || `${title} at ${company}. Location: ${location}. Experience: ${experience}. ${salary ? 'Salary: ' + salary : ''}`,
          salary_min: salaryMin,
          salary_max: null,
          salary_stated: salaryStated,
          posted_date: new Date().toISOString(),
        });
      });

      await sleep(1500);
    } catch (err) {
      console.error(`  Naukri error for "${search.query}":`, err.message);
    }
  }

  console.log(`  ✓ Naukri: ${jobs.length} real jobs fetched`);
  return jobs;
}

function guessSector(text) {
  const t = text.toLowerCase();
  if (t.includes('ai') || t.includes('machine learning') || t.includes('artificial intelligence')) return 'AI';
  if (t.includes('fintech') || t.includes('finance') || t.includes('payment') || t.includes('banking')) return 'Fintech';
  if (t.includes('supply chain') || t.includes('logistics') || t.includes('ecommerce') || t.includes('e-commerce')) return 'Supply chain';
  if (t.includes('consumer') || t.includes('d2c') || t.includes('retail') || t.includes('brand')) return 'Consumer';
  if (t.includes('saas') || t.includes('software') || t.includes('tech')) return 'SaaS';
  if (t.includes('health') || t.includes('pharma') || t.includes('medical')) return 'Healthtech';
  return 'Startup';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
