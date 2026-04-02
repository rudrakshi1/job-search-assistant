import { chromium } from 'playwright';
import axios from 'axios';

export async function fetchFounderProfile(companyName) {
  const result = {
    company: companyName,
    founderName: null,
    founderTitle: null,
    founderLinkedIn: null,
    founderBackground: null,
    founderEducation: null,
    founderPreviousCompanies: [],
    recentPosts: [],
    domainCredibility: null,
    isOperator: null,
    redFlags: [],
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Strategy 1: Search LinkedIn for founder/CEO of company
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('founder CEO ' + companyName)}&origin=GLOBAL_SEARCH_HEADER`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);

    const people = await page.evaluate(() => {
      const cards = document.querySelectorAll('.entity-result__item, li.reusable-search__result-container');
      const results = [];
      cards.forEach((card, i) => {
        if (i >= 5) return;
        const name = card.querySelector('.entity-result__title-text a span[aria-hidden="true"], .actor-name')?.textContent?.trim();
        const title = card.querySelector('.entity-result__primary-subtitle, .subline-level-1')?.textContent?.trim();
        const link = card.querySelector('a.app-aware-link, a[href*="/in/"]')?.href;
        const summary = card.querySelector('.entity-result__summary, .subline-level-2')?.textContent?.trim();
        if (name && title) results.push({ name, title, link, summary });
      });
      return results;
    });

    // Find the most likely founder/CEO — prioritise people at the target company
    const founder = people.find(p => {
      const t = (p.title || '').toLowerCase();
      const s = (p.summary || '').toLowerCase();
      return (t.includes('founder') || t.includes('ceo') || t.includes('co-founder')) &&
        (t.includes(companyName.toLowerCase().split(' ')[0]) || s.includes(companyName.toLowerCase().split(' ')[0]));
    }) || people.find(p => {
      const t = (p.title || '').toLowerCase();
      return t.includes('founder') || t.includes('ceo') || t.includes('co-founder');
    }) || people[0];

    if (founder) {
      result.founderName = founder.name;
      result.founderTitle = founder.title;
      result.founderLinkedIn = founder.link;

      // Strategy 2: Visit their LinkedIn profile for full detail
      if (founder.link && founder.link.includes('linkedin.com/in/')) {
        try {
          await page.goto(founder.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2500);

          const profileData = await page.evaluate(() => {
            const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
            const getAll = (sel) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim()).filter(Boolean);

            return {
              about: getText('.pv-shared-text-with-see-more .visually-hidden, #about ~ div .display-flex span[aria-hidden="true"]'),
              headline: getText('.text-body-medium.break-words'),
              education: getAll('#education ~ div .pvs-entity .mr1 span[aria-hidden="true"]').slice(0, 4),
              experience: getAll('#experience ~ div .pvs-entity .mr1 span[aria-hidden="true"]').slice(0, 8),
              recentActivity: getAll('.feed-shared-update-v2 .break-words span[aria-hidden="true"]').slice(0, 2),
              followerCount: getText('.pvs-header__subtitle .pvs-header__optional-link'),
            };
          });

          if (profileData.about) result.founderBackground = profileData.about.slice(0, 500);
          if (profileData.headline) result.founderTitle = profileData.headline;
          if (profileData.education?.length) result.founderEducation = profileData.education.filter(e => e.length > 2).join(' · ');
          if (profileData.experience?.length) result.founderPreviousCompanies = profileData.experience.filter(e => e.length > 2);
          if (profileData.recentActivity?.length) result.recentPosts = profileData.recentActivity.map(t => t.slice(0, 200));
        } catch (err) {
          console.log(`    Profile visit failed: ${err.message}`);
        }
      }

      // Strategy 3: If profile data is sparse, try Google search for founder info
      if (!result.founderBackground && !result.founderEducation) {
        try {
          const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(founder.name + ' ' + companyName + ' founder background education')}`;
          await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForTimeout(1500);

          const googleData = await page.evaluate(() => {
            const snippets = Array.from(document.querySelectorAll('.VwiC3b, .yDYNvb, .MUxGbd')).map(el => el.textContent?.trim()).filter(Boolean);
            return snippets.slice(0, 3).join(' ');
          });
          if (googleData) result.founderBackground = googleData.slice(0, 400);
        } catch {}
      }

      result.domainCredibility = assessDomainCredibility(result, companyName);
      result.isOperator = assessOperatorBackground(result);
      result.redFlags = identifyRedFlags(result, companyName);
    }

    await browser.close();
  } catch (err) {
    console.error(`    Founder profile error for ${companyName}:`, err.message);
    if (browser) await browser.close().catch(() => {});
  }

  return result;
}

function assessDomainCredibility(profile, companyName) {
  const allText = [
    profile.founderBackground || '',
    profile.founderTitle || '',
    (profile.founderPreviousCompanies || []).join(' '),
    profile.founderEducation || '',
  ].join(' ').toLowerCase();

  const companyLower = companyName.toLowerCase();
  const isAI = companyLower.includes('ai') || allText.includes('artificial intelligence') || allText.includes('machine learning') || allText.includes('deep learning');
  const isFintech = companyLower.includes('fin') || companyLower.includes('pay') || companyLower.includes('bank') || allText.includes('fintech');
  const isLogistics = companyLower.includes('logistics') || companyLower.includes('supply') || companyLower.includes('delivery');

  if (allText.includes('google ads') && isFintech) return '⚠ Mismatch — ad/marketing background building fintech (Goodscore pattern)';
  if (allText.includes('iit') || allText.includes('iim') || allText.includes('stanford') || allText.includes('harvard') || allText.includes('wharton')) {
    return 'Strong — top-tier academic background';
  }
  if ((isAI && (allText.includes('ai') || allText.includes('ml') || allText.includes('data') || allText.includes('engineer'))) ||
      (isFintech && (allText.includes('finance') || allText.includes('banking') || allText.includes('fintech') || allText.includes('investment'))) ||
      (isLogistics && (allText.includes('supply') || allText.includes('logistics') || allText.includes('operations')))) {
    return 'Strong — domain aligned with company sector';
  }
  return 'Moderate — review background manually';
}

function assessOperatorBackground(profile) {
  const allText = [profile.founderBackground || '', (profile.founderPreviousCompanies || []).join(' ')].join(' ').toLowerCase();
  const operatorSignals = ['operations', 'product', 'engineering', 'built', 'launched', 'scaled', 'cto', 'coo', 'vp', 'director', 'led', 'managed'];
  const investorSignals = ['investor', 'vc', 'venture', 'partner at', 'angel', 'portfolio'];
  const isOperator = operatorSignals.some(s => allText.includes(s));
  const isInvestor = investorSignals.some(s => allText.includes(s));
  if (isOperator && !isInvestor) return 'Operator — has built and run teams';
  if (isInvestor && !isOperator) return 'Investor background — primarily capital allocator, not operator';
  if (isOperator && isInvestor) return 'Operator-turned-investor — strong both ways';
  return 'Unknown — review profile manually';
}

function identifyRedFlags(profile, companyName) {
  const flags = [];
  const allText = [profile.founderBackground || '', (profile.founderPreviousCompanies || []).join(' ')].join(' ').toLowerCase();
  if (allText.includes('google ads') || (allText.includes('performance marketing') && companyName.toLowerCase().includes('fin'))) {
    flags.push('Background in ads/marketing building fintech — low domain credibility (Goodscore pattern)');
  }
  if (!profile.founderBackground && !profile.founderEducation) {
    flags.push('Limited public profile — manual research recommended');
  }
  return flags;
}

export function buildFounderSummary(profile) {
  if (!profile || !profile.founderName) return null;
  let parts = [];
  parts.push(`${profile.founderName} (${profile.founderTitle || 'Founder/CEO'})`);
  if (profile.founderEducation) parts.push(`Education: ${profile.founderEducation}`);
  if (profile.founderLinkedIn) parts.push(`LinkedIn: ${profile.founderLinkedIn}`);
  if (profile.domainCredibility) parts.push(`Domain: ${profile.domainCredibility}`);
  if (profile.isOperator) parts.push(`Background: ${profile.isOperator}`);
  if (profile.redFlags?.length) parts.push(`⚠ ${profile.redFlags.join('; ')}`);
  if (profile.recentPosts?.length) parts.push(`Recent activity: ${profile.recentPosts[0].slice(0, 100)}`);
  return parts.join(' · ');
}
