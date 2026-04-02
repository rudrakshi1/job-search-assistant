/**
 * LinkedIn Easy Apply — Phase 2
 * Uses your existing Chrome session (no headless) so LinkedIn sees you logged in
 * Pre-fills all fields including AI-generated answers
 * ALWAYS shows review modal before submitting
 */

import { chromium } from 'playwright';
import axios from 'axios';
import 'dotenv/config';

import { CANDIDATE } from '../../config/profile.js';

const ANSWER_BANK = {
  notice_days: (CANDIDATE.noticePeriod || '').match(/\d+/)?.[0] || '45',
  notice_text: CANDIDATE.noticePeriod || 'Currently serving notice',
  current_ctc: CANDIDATE.currentCTC?.replace(/[^0-9]/g,'') || '',
  current_ctc_lpa: Math.round(parseInt(CANDIDATE.currentCTC?.replace(/[^0-9]/g,'') || '0') / 100000).toString(),
  expected_ctc: 'Open to discussion based on role',
  years_experience: '1',
  total_experience: '1',
  location: CANDIDATE.locations?.[0] ? CANDIDATE.locations[0] + ', India' : 'Bengaluru, India',
  relocation: 'Yes',
  work_authorization: 'Yes',
  work_mode: 'Open to all',
  gender: 'Female',
  education: CANDIDATE.education || 'B.Tech, Top University',
  linkedin: 'https://' + (CANDIDATE.linkedin || 'linkedin.com/in/your-profile'),
  phone: CANDIDATE.phone || '',
  email: CANDIDATE.email || '',
};

// Get AI-generated why interested answer for this specific job
async function getWhyInterestedAnswer(job) {
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Write a 2-sentence answer for "Why are you interested in this role?" for ${CANDIDATE.name} applying to ${job.title} at ${job.company}.
Context: ${CANDIDATE.name}. ${CANDIDATE.background}
Company intel: ${(job.company_intel || '').slice(0, 200)}
Keep it specific, confident, under 60 words. No "I am excited to". Just the answer.`,
      }],
      temperature: 0,
      max_tokens: 100,
    }, {
      headers: { Authorization: `Bearer ${[process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean)[Math.floor(Math.random()*2)%([process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean).length)]}` },
      timeout: 10000,
    });
    return res.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return `${job.company}'s work in ${job.sector || 'this space'} aligns with my goal to work at the intersection of technology and business building. I want to contribute directly to the company's growth while learning from the founding team.`;
  }
}

export async function prefillLinkedInEasyApply(jobUrl, jobId, companyName, score, job = {}) {
  const result = {
    jobId, company: companyName, url: jobUrl, status: 'prefilling',
    fieldsFound: [], fieldValues: {}, requiresReview: true, errors: [],
    screenshot: null, whyInterested: '',
  };

  // Get AI answer for why interested
  result.whyInterested = await getWhyInterestedAnswer(job);

  let browser;
  try {
    // Try to connect to existing Chrome session first (user must run Chrome with remote debugging)
    // Falls back to launching new browser if not available
    let usingExistingSession = false;
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222');
      usingExistingSession = true;
      console.log('  ✓ Connected to existing Chrome session (logged into LinkedIn)');
    } catch {
      // Launch new browser - user will need to log in
      browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        slowMo: 200,
      });
      console.log('  ℹ Launched new browser — log into LinkedIn if prompted');
    }

    const context = usingExistingSession
      ? browser.contexts()[0]
      : await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

    const page = usingExistingSession
      ? await context.newPage()
      : await context.newPage();

    // Navigate to job posting
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Click Easy Apply button
    const easyApplySelectors = [
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply"]',
      '.jobs-apply-button--top-card button',
      'button.artdeco-button--primary:has-text("Easy Apply")',
    ];

    let clicked = false;
    for (const sel of easyApplySelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          clicked = true;
          console.log(`  ✓ Clicked Easy Apply button`);
          break;
        }
      } catch {}
    }

    if (!clicked) {
      // Try clicking by text
      try {
        await page.click('button:has-text("Easy Apply")');
        clicked = true;
      } catch {}
    }

    if (!clicked) {
      result.status = 'no_easy_apply';
      result.errors.push('Easy Apply button not found — may require external application or LinkedIn Premium');
      await browser.close().catch(() => {});
      return result;
    }

    await page.waitForTimeout(2500);

    // Fill all form pages
    const filled = await fillAllFormFields(page, ANSWER_BANK, result.whyInterested, companyName);
    result.fieldsFound = filled.found;
    result.fieldValues = filled.values;

    // Take screenshot
    try {
      result.screenshot = 'data:image/png;base64,' + await page.screenshot({ encoding: 'base64' });
    } catch {}

    result.status = 'ready_for_review';
    result.message = `Form pre-filled with ${filled.found.length} fields. Review before submitting.`;

    // Keep browser open for user to review
    global._linkedinPage = page;
    global._linkedinBrowser = browser;
    global._linkedinJobId = jobId;
    global._usingExistingSession = usingExistingSession;

  } catch (err) {
    console.error(`LinkedIn apply error:`, err.message);
    result.status = 'error';
    result.errors.push(err.message);
    if (browser) await browser.close().catch(() => {});
  }

  return result;
}

async function fillAllFormFields(page, answers, whyInterested, companyName) {
  const found = [];
  const values = {};

  // Fill up to 5 form pages
  for (let pageNum = 0; pageNum < 5; pageNum++) {
    await page.waitForTimeout(1000);

    // Get all visible inputs
    const inputs = await page.$$('input:visible, textarea:visible, select:visible').catch(() => []);

    for (const input of inputs) {
      try {
        const tagName = await input.evaluate(el => el.tagName.toLowerCase());
        const type = await input.evaluate(el => el.type || '');
        const id = await input.evaluate(el => el.id || '');
        const name = await input.evaluate(el => el.name || '');
        const placeholder = await input.evaluate(el => el.placeholder || '');
        const ariaLabel = await input.evaluate(el => el.getAttribute('aria-label') || '');
        const labelText = await input.evaluate(el => {
          const lbl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
          const parent = el.closest('.fb-dash-form-element, [data-test-form-element], .jobs-easy-apply-form-element');
          const parentLabel = parent?.querySelector('label, legend, span.artdeco-text-input--label');
          return (lbl?.textContent || parentLabel?.textContent || '').toLowerCase().trim();
        });

        const allText = [labelText, ariaLabel, placeholder, name, id].join(' ').toLowerCase();
        let value = null;

        if (type === 'radio' || type === 'checkbox') continue; // Handle separately

        if (allText.includes('phone') || allText.includes('mobile')) value = answers.phone;
        else if (allText.includes('email')) value = answers.email;
        else if (allText.includes('notice') && (allText.includes('period') || allText.includes('days'))) value = answers.notice_days;
        else if (allText.includes('current') && allText.includes('ctc')) value = answers.current_ctc_lpa;
        else if (allText.includes('current') && allText.includes('salary')) value = answers.current_ctc_lpa;
        else if (allText.includes('expected') && (allText.includes('ctc') || allText.includes('salary'))) value = answers.expected_ctc;
        else if (allText.includes('year') && allText.includes('experience')) value = answers.years_experience;
        else if (allText.includes('total') && allText.includes('experience')) value = answers.total_experience;
        else if ((allText.includes('why') && allText.includes('interest')) || allText.includes('cover note') || allText.includes('motivation')) value = whyInterested;
        else if (allText.includes('about yourself') || allText.includes('tell us about you')) value = `${CANDIDATE.name} | ${CANDIDATE.education} | Available ${CANDIDATE.availableFrom}`;
        else if (allText.includes('linkedin')) value = answers.linkedin;
        else if (allText.includes('website') || allText.includes('portfolio')) value = answers.linkedin;
        else if (allText.includes('city') || allText.includes('location') || allText.includes('where')) value = 'Bengaluru';
        else if (allText.includes('cgpa') || allText.includes('gpa')) value = (CANDIDATE.education||'').match(/[\d.]+/)?.[0] || '';
        else if (allText.includes('college') || allText.includes('university') || allText.includes('institution')) value = (CANDIDATE.education || '').split(',')[1]?.trim() || 'University';
        else if (allText.includes('degree') || allText.includes('qualification')) value = 'B.Tech Production and Industrial Engineering';
        else if (allText.includes('year of graduation') || allText.includes('pass out')) value = '2025';

        if (value) {
          if (tagName === 'select') {
            await input.selectOption({ label: value }).catch(() => {});
          } else {
            await input.fill('').catch(() => {});
            await input.fill(value).catch(() => {});
          }
          const label = labelText || ariaLabel || placeholder || name;
          if (!found.includes(label)) {
            found.push(label);
            values[label] = value;
          }
        }
      } catch {}
    }

    // Handle radio buttons (yes/no questions)
    const radios = await page.$$('input[type="radio"]:visible').catch(() => []);
    for (const radio of radios) {
      try {
        const val = (await radio.getAttribute('value') || '').toLowerCase();
        const label = await radio.evaluate(el => {
          const parent = el.closest('[data-test-form-element], .fb-dash-form-element');
          return (parent?.querySelector('legend, label')?.textContent || '').toLowerCase();
        });
        const shouldSelectYes = label.includes('authoriz') || label.includes('eligible') ||
          label.includes('relocat') || label.includes('background check') ||
          label.includes('legally') || label.includes('agree');
        if (shouldSelectYes && val === 'yes') {
          await radio.check().catch(() => {});
          found.push(`Yes/No: ${label.slice(0, 50)}`);
          values[label] = 'Yes';
        }
      } catch {}
    }

    // Check for Next button
    const nextBtn = await page.$('button[aria-label="Continue to next step"], button:has-text("Next"), button:has-text("Review")').catch(() => null);
    if (nextBtn) {
      const btnText = await nextBtn.textContent().catch(() => '');
      if (btnText.toLowerCase().includes('review') || btnText.toLowerCase().includes('submit')) {
        break; // Reached review/submit step — stop here
      }
      await nextBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      break;
    }
  }

  return { found, values };
}

export async function submitLinkedInApplication(jobId) {
  if (global._linkedinJobId !== jobId || !global._linkedinPage) {
    return { ok: false, error: 'No active LinkedIn session. Start Easy Apply again.' };
  }

  try {
    const page = global._linkedinPage;

    // Click Submit application button
    const submitBtn = await page.$('button[aria-label="Submit application"], button:has-text("Submit application")');
    if (!submitBtn) {
      return { ok: false, error: 'Submit button not found. Please click Submit manually in the browser window.' };
    }

    await submitBtn.click();
    await page.waitForTimeout(2000);

    const success = await page.$('.artdeco-inline-feedback--success, [data-test-job-success]').catch(() => null);

    if (!global._usingExistingSession && global._linkedinBrowser) {
      await global._linkedinBrowser.close().catch(() => {});
    } else if (global._linkedinPage) {
      await global._linkedinPage.close().catch(() => {});
    }

    global._linkedinPage = null;
    global._linkedinBrowser = null;
    global._linkedinJobId = null;

    return { ok: true, submitted: !!success };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function discardLinkedInSession() {
  try {
    if (!global._usingExistingSession && global._linkedinBrowser) {
      await global._linkedinBrowser.close().catch(() => {});
    } else if (global._linkedinPage) {
      await global._linkedinPage.close().catch(() => {});
    }
  } catch {}
  global._linkedinPage = null;
  global._linkedinBrowser = null;
  global._linkedinJobId = null;
  return { ok: true };
}
