import { chromium } from 'playwright';

// Keywords that indicate a job post from a founder
const JOB_KEYWORDS = [
  "we're hiring", "we are hiring", "looking for", "join our team",
  "founder's office", "chief of staff", "head of strategy",
  "entrepreneur in residence", "EIR", "founding team",
  "strategy ops", "special ops", "generalist",
  "apply now", "DM me", "reach out", "send your CV",
];

const SEARCH_QUERIES = [
  "hiring founder's office bangalore",
  "hiring chief of staff startup india",
  "hiring EIR startup india",
  "we're hiring strategy operations startup",
  "founding team member strategy india",
];

export async function fetchLinkedInPosts() {
  const jobs = [];
  const seen = new Set();
  let browser;

  try {
    console.log('  LinkedIn posts: launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    for (const query of SEARCH_QUERIES) {
      try {
        const page = await context.newPage();
        const encoded = encodeURIComponent(query);
        // LinkedIn public post search
        const url = `https://www.linkedin.com/search/results/content/?keywords=${encoded}&datePosted=past-week&sortBy=date_posted`;

        console.log(`  LinkedIn posts: searching "${query}"...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2500);

        const posts = await page.evaluate((jobKeywords) => {
          const results = [];
          const cards = document.querySelectorAll('.search-results__list li, .feed-shared-update-v2, .occludable-update');

          cards.forEach((card, i) => {
            if (i >= 5) return;
            const text = card.innerText || card.textContent || '';
            const textLower = text.toLowerCase();

            // Check if this post contains job-related keywords
            const hasJobKeyword = jobKeywords.some(kw => textLower.includes(kw.toLowerCase()));
            if (!hasJobKeyword) return;

            // Extract author/company
            const author = card.querySelector('.app-aware-link span[aria-hidden="true"], .actor-name, .feed-shared-actor__name')?.textContent?.trim();
            const authorTitle = card.querySelector('.feed-shared-actor__description, .actor-description')?.textContent?.trim();
            const postUrl = card.querySelector('a.app-aware-link')?.href;

            // Extract key info from post text
            const lines = text.split('\n').filter(l => l.trim().length > 10);
            const snippet = lines.slice(0, 5).join(' ').slice(0, 300);

            if (author && snippet) {
              results.push({ author, authorTitle, snippet, postUrl, fullText: text.slice(0, 800) });
            }
          });
          return results;
        }, JOB_KEYWORDS);

        for (const post of posts) {
          // Try to extract role title from post text
          const title = extractRoleTitle(post.fullText) || "Opportunity via LinkedIn Post";
          const company = extractCompany(post.author, post.authorTitle, post.fullText) || post.author || 'Unknown';
          const key = `post-${post.author}-${title}`.toLowerCase().replace(/\s+/g, '');

          if (seen.has(key)) continue;
          seen.add(key);

          jobs.push({
            id: `linkedin-post-${key.slice(0, 40)}`,
            title,
            company,
            location: extractLocation(post.fullText) || 'India',
            sector: 'Unknown',
            source: 'linkedin_post',
            url: post.postUrl || 'https://linkedin.com',
            jd_text: `[Found via LinkedIn post by ${post.author}${post.authorTitle ? ', ' + post.authorTitle : ''}]\n\n${post.fullText}`,
            salary_min: null,
            salary_max: null,
            salary_stated: false,
            posted_date: new Date().toISOString(),
          });
        }

        await page.close();
        await sleep(2000);
      } catch (err) {
        console.error(`  LinkedIn posts error for "${query}":`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error('  LinkedIn posts scraper error:', err.message);
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`  ✓ LinkedIn posts: ${jobs.length} informal opportunities found`);
  return jobs;
}

function extractRoleTitle(text) {
  const patterns = [
    /hiring (?:a |an )?([A-Z][^.!?\n]{5,50}?)[\s.,!]/i,
    /looking for (?:a |an )?([A-Z][^.!?\n]{5,50}?)[\s.,!]/i,
    /role[:\s]+([A-Z][^.!?\n]{5,50}?)[\s.,!]/i,
    /position[:\s]+([A-Z][^.!?\n]{5,50}?)[\s.,!]/i,
    /(Chief of Staff|Founder'?s? Office|EIR|Entrepreneur in Residence|Head of Strategy|Strategy Lead|Chief of Staff)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim().slice(0, 60);
  }
  return null;
}

function extractCompany(author, authorTitle, text) {
  if (authorTitle) {
    const atMatch = authorTitle.match(/at\s+([A-Z][^\n,|]{2,40})/i);
    if (atMatch) return atMatch[1].trim();
    const dashMatch = authorTitle.match(/[–-]\s*([A-Z][^\n,|]{2,40})/i);
    if (dashMatch) return dashMatch[1].trim();
  }
  const companyPatterns = [
    /at\s+([A-Z][a-zA-Z0-9\s]{2,30}?)[\s.,!]/,
    /join\s+([A-Z][a-zA-Z0-9\s]{2,30}?)[\s.,!]/,
    /([A-Z][a-zA-Z0-9]{2,20}(?:\s[A-Z][a-zA-Z0-9]{2,15})?)\s+is hiring/i,
  ];
  for (const p of companyPatterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return author;
}

function extractLocation(text) {
  const locations = ['Bangalore', 'Bengaluru', 'Mumbai', 'Gurugram', 'Delhi', 'Hyderabad', 'Chennai', 'Pune', 'Remote', 'Hybrid'];
  for (const loc of locations) {
    if (text.toLowerCase().includes(loc.toLowerCase())) return loc;
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
