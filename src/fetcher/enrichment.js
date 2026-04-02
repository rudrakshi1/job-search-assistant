/**
 * Pre-enrichment pass — runs BEFORE scoring, once per company, cached
 * Glassdoor via Google (fast, no login) + LinkedIn founder lookup
 * Results stored in DB — same company never enriched twice
 */

import { chromium } from 'playwright';
import 'dotenv/config';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// In-memory cache — same company never enriched twice per session
const enrichmentCache = new Map();

export async function enrichCompany(companyName) {
  const key = companyName.toLowerCase().trim();
  if (enrichmentCache.has(key)) return enrichmentCache.get(key);

  const result = {
    company: companyName,
    glassdoor: { rating: null, reviewCount: null, ceoApproval: null, ceoName: null, wlbRating: null, stabilitySignals: [], companyAge: null },
    founder: { name: null, title: null, domainCredibility: null, redFlags: [] },
    enrichedAt: new Date().toISOString(),
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: UA });

    const [gd, fd] = await Promise.allSettled([
      getGlassdoorViaGoogle(context, companyName),
      getFounderViaLinkedIn(context, companyName),
    ]);

    if (gd.status === 'fulfilled') Object.assign(result.glassdoor, gd.value);
    if (fd.status === 'fulfilled') Object.assign(result.founder, fd.value);

    await browser.close();
  } catch (err) {
    console.log(`    Enrichment error for ${companyName}: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
  }

  enrichmentCache.set(key, result);
  return result;
}

async function getGlassdoorViaGoogle(context, companyName) {
  const result = { rating: null, reviewCount: null, ceoApproval: null, ceoName: null, wlbRating: null, stabilitySignals: [], companyAge: null };
  try {
    const page = await context.newPage();
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(companyName + ' glassdoor rating reviews india')}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;
      const ratingMatch = text.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)/i) || text.match(/(?:rating|rated)[:\s]+(\d\.\d)/i);
      const reviewMatch = text.match(/(\d[\d,]+)\s+reviews?/i);
      const ceoMatch = text.match(/(\d+)%?\s*(?:approve?s?\s+of\s+CEO|CEO\s+approval)/i);
      const ceoNameMatch = text.match(/CEO[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/);
      const foundedMatch = text.match(/[Ff]ounded[:\s]+(\d{4})/);
      return {
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: reviewMatch ? reviewMatch[1] : null,
        ceoApproval: ceoMatch ? ceoMatch[1] + '%' : null,
        ceoName: ceoNameMatch ? ceoNameMatch[1] : null,
        companyAge: foundedMatch ? (new Date().getFullYear() - parseInt(foundedMatch[1])) + ' yrs' : null,
        layoff: /layoff|laid off/i.test(text),
        micro: /micromanag/i.test(text),
        turnover: /high turnover|attrition/i.test(text),
      };
    });

    if (data.rating && data.rating >= 1 && data.rating <= 5) result.rating = data.rating;
    if (data.reviewCount) result.reviewCount = data.reviewCount;
    if (data.ceoApproval) result.ceoApproval = data.ceoApproval;
    if (data.ceoName) result.ceoName = data.ceoName;
    if (data.companyAge) result.companyAge = data.companyAge;
    if (data.layoff) result.stabilitySignals.push('Layoff mentions in reviews');
    if (data.micro) result.stabilitySignals.push('Micromanagement mentioned');
    if (data.turnover) result.stabilitySignals.push('High turnover mentioned');

    await page.close();
  } catch (err) {
    console.log(`    Glassdoor failed for ${companyName}: ${err.message}`);
  }
  return result;
}

async function getFounderViaLinkedIn(context, companyName) {
  const result = { name: null, title: null, domainCredibility: null, redFlags: [] };
  try {
    const page = await context.newPage();
    await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('founder CEO ' + companyName)}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(1500);

    const people = await page.evaluate(() => {
      const cards = document.querySelectorAll('.entity-result__item, li.reusable-search__result-container');
      const out = [];
      cards.forEach((c, i) => {
        if (i >= 3) return;
        const name = c.querySelector('.entity-result__title-text a span[aria-hidden="true"]')?.textContent?.trim();
        const title = c.querySelector('.entity-result__primary-subtitle')?.textContent?.trim();
        const summary = c.querySelector('.entity-result__summary')?.textContent?.trim() || '';
        if (name && title) out.push({ name, title, summary });
      });
      return out;
    });

    const founder = people.find(p => { const t = (p.title || '').toLowerCase(); return t.includes('founder') || t.includes('ceo') || t.includes('co-founder'); }) || people[0];

    if (founder) {
      result.name = founder.name;
      result.title = founder.title;
      const allText = [founder.title, founder.summary].join(' ').toLowerCase();
      const hasAdsBg = allText.includes('google ads') || allText.includes('performance marketing');
      const isFintech = companyName.toLowerCase().includes('fin') || companyName.toLowerCase().includes('pay');
      if (hasAdsBg && isFintech) {
        result.redFlags.push('Ads background building fintech — domain mismatch signal');
        result.domainCredibility = 'Weak';
      } else if (allText.includes('iit') || allText.includes('iim') || allText.includes('stanford') || allText.includes('harvard')) {
        result.domainCredibility = 'Strong — top-tier academic background';
      } else if (allText.includes('founder') || allText.includes('cto') || allText.includes('engineer')) {
        result.domainCredibility = 'Moderate — operator background';
      } else {
        result.domainCredibility = 'Unknown — review manually';
      }
    }

    await page.close();
  } catch (err) {
    console.log(`    LinkedIn founder failed for ${companyName}: ${err.message}`);
  }
  return result;
}

// Called by server.js after enrichCompany()
export function buildEnrichmentSummary(enrichment) {
  if (!enrichment) return { glassdoorSummary: null, founderSummary: null, flags: {} };

  const g = enrichment.glassdoor || {};
  const f = enrichment.founder || {};
  const flags = {};

  let glassdoorSummary = null;
  if (g.rating) {
    const parts = [`Glassdoor: ${g.rating}/5`];
    if (g.reviewCount) parts.push(`${g.reviewCount} reviews`);
    if (g.ceoName) parts.push(`CEO: ${g.ceoName}`);
    if (g.ceoApproval) parts.push(`CEO approval: ${g.ceoApproval}`);
    if (g.companyAge) parts.push(g.companyAge);
    if (g.stabilitySignals?.length) { parts.push(`\u26a0 ${g.stabilitySignals.join(', ')}`); flags.stabilityRisk = true; }
    if (g.rating < 3.5) flags.lowGlassdoor = true;
    if (g.wlbRating && g.wlbRating < 3.2) flags.wlbRisk = true;
    glassdoorSummary = parts.join(' \u00b7 ');
  }

  let founderSummary = null;
  if (f.name) {
    const parts = [`${f.name} (${f.title || 'Founder/CEO'})`];
    if (f.domainCredibility) parts.push(`Domain: ${f.domainCredibility}`);
    if (f.redFlags?.length) { parts.push(`\u26a0 ${f.redFlags[0]}`); flags.founderDomainMismatch = true; }
    founderSummary = parts.join(' \u00b7 ');
  }

  return { glassdoorSummary, founderSummary, flags };
}
