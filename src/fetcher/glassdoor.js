import { chromium } from 'playwright';
import 'dotenv/config';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchGlassdoorData(companyName) {
  const result = {
    company: companyName, rating: null, reviewCount: null,
    ceoApproval: null, ceoName: null, recommendToFriend: null,
    wlbRating: null, pros: [], cons: [], commonTerms: [],
    stabilitySignals: [], companyAge: null, headcount: null,
    salaryRange: null, source: 'glassdoor',
  };

  try {
    const r = await fetchViaGoogle(companyName);
    if (r.rating) { Object.assign(result, r); return result; }
  } catch (e) { console.log(`    Glassdoor Google failed: ${e.message}`); }

  try {
    const r = await fetchViaDirect(companyName);
    if (r.rating) { Object.assign(result, r); return result; }
  } catch (e) { console.log(`    Glassdoor direct failed: ${e.message}`); }

  console.log(`    Glassdoor: no data for ${companyName}`);
  return result;
}

async function fetchViaGoogle(companyName) {
  const result = { rating: null };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    const query = `${companyName} glassdoor rating reviews india`;
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded', timeout: 12000,
    });
    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;
      const ratingMatch = text.match(/(\d\.\d)\s*(?:out of 5|stars?|\/5|★)/i) ||
                          text.match(/(?:rating|rated)[:\s]+(\d\.\d)/i);
      const reviewMatch = text.match(/(\d[\d,]+)\s+reviews?/i);
      const ceoMatch = text.match(/(\d+)%?\s*(?:approve?s? of CEO|CEO approval)/i);
      const recMatch = text.match(/(\d+)%?\s*(?:would recommend|recommend to a friend)/i);
      const ceoNameMatch = text.match(/CEO[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/);
      return {
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: reviewMatch ? reviewMatch[1] : null,
        ceoApproval: ceoMatch ? ceoMatch[1] + '%' : null,
        recommendToFriend: recMatch ? recMatch[1] + '%' : null,
        ceoName: ceoNameMatch ? ceoNameMatch[1] : null,
      };
    });

    if (data.rating && data.rating >= 1 && data.rating <= 5) {
      Object.assign(result, data);
    }

    await browser.close();
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
  return result;
}

async function fetchViaDirect(companyName) {
  const result = { rating: null };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    await page.goto(
      `https://www.glassdoor.co.in/Reviews/company-reviews.htm?suggestCount=10&suggestChosen=false&clickSource=searchBtn&typedKeyword=${encodeURIComponent(companyName)}&sc.keyword=${encodeURIComponent(companyName)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    const firstResult = await page.$('[data-test="employer-name"], .eiHdrBar a, .company-tile a');
    if (firstResult) {
      await firstResult.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const data = await extractGlassdoorPageData(page);
    Object.assign(result, data);
    await browser.close();
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
  return result;
}

async function extractGlassdoorPageData(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || '';

    const ratingEl = document.querySelector('[data-test="rating-info"] .ratingNumber, .ratingNum, [class*="ratingNum"]');
    const rating = ratingEl ? parseFloat(ratingEl.textContent) : null;
    const reviewCount = document.querySelector('[data-test="reviewsCount"]')?.textContent?.trim() || null;
    const ceoApproval = document.querySelector('[data-test="ceo-approval"], [class*="ceoApproval"]')?.textContent?.trim() || null;
    const ceoName = document.querySelector('[data-test="ceo-name"], [class*="ceoName"]')?.textContent?.trim() || null;
    const wlbEl = document.querySelector('[class*="workLifeBalance"] [class*="ratingNum"]');
    const wlbRating = wlbEl ? parseFloat(wlbEl.textContent) : null;

    const pros = Array.from(document.querySelectorAll('[data-test="pros"] span, [class*="pros"] p')).map(e => e.textContent?.trim()).filter(Boolean).slice(0, 3);
    const cons = Array.from(document.querySelectorAll('[data-test="cons"] span, [class*="cons"] p')).map(e => e.textContent?.trim()).filter(Boolean).slice(0, 3);

    const commonTerms = [];
    const rt = bodyText.toLowerCase();
    ['great culture','good work-life','learning','growth','ownership','fast-paced','innovative','smart people'].forEach(t => { if (rt.includes(t)) commonTerms.push('✓ ' + t); });
    ['micromanagement','high turnover','layoff','no job security','poor management'].forEach(t => { if (rt.includes(t)) commonTerms.push('⚠ ' + t); });

    const foundedMatch = bodyText.match(/[Ff]ounded[:\s]+(\d{4})/);
    const companyAge = foundedMatch ? (new Date().getFullYear() - parseInt(foundedMatch[1])) + ' yrs (est. ' + foundedMatch[1] + ')' : null;

    const stabilitySignals = [];
    if (rt.includes('layoff') || rt.includes('laid off')) stabilitySignals.push('Layoff mentions');
    if (rt.includes('micromanag')) stabilitySignals.push('Micromanagement mentioned');
    if (rt.includes('high turnover') || rt.includes('attrition')) stabilitySignals.push('High turnover');
    if (wlbRating && wlbRating < 3.2) stabilitySignals.push('Low WLB: ' + wlbRating + '/5');

    return { rating, reviewCount, ceoApproval, ceoName, wlbRating, pros, cons, commonTerms, companyAge, stabilitySignals };
  });
}

export function buildGlassdoorSummary(data) {
  if (!data || !data.rating) return null;
  const parts = [`${data.rating}/5`];
  if (data.reviewCount) parts.push(`${data.reviewCount} reviews`);
  if (data.ceoName) parts.push(`CEO: ${data.ceoName}`);
  if (data.ceoApproval) parts.push(`CEO approval: ${data.ceoApproval}`);
  if (data.recommendToFriend) parts.push(`${data.recommendToFriend} recommend`);
  if (data.wlbRating) parts.push(`WLB: ${data.wlbRating}/5`);
  if (data.companyAge) parts.push(data.companyAge);
  if (data.commonTerms?.length) parts.push(data.commonTerms.slice(0, 3).join(', '));
  if (data.stabilitySignals?.length) parts.push('⚠ ' + data.stabilitySignals.join('; '));
  return `Glassdoor: ${parts.join(' · ')}`;
}

export function glassdoorFlags(data) {
  const flags = {};
  if (!data) return flags;
  if (data.rating && data.rating < 3.5) flags.lowGlassdoor = true;
  if (data.wlbRating && data.wlbRating < 3.2) flags.wlbRisk = true;
  if (data.stabilitySignals?.length > 0) flags.stabilityRisk = true;
  if (data.ceoApproval && parseInt(data.ceoApproval) < 50) flags.lowCEOApproval = true;
  return flags;
}
