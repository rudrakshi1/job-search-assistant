/**
 * Gmail Action — uses Groq for email generation (same key as scorer)
 * Gmail MCP send handled via fallback modal in dashboard
 */
import axios from 'axios';
import { CANDIDATE } from '../../config/profile.js';
import 'dotenv/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function generateCoverEmail(job, scoreData) {
  const candidateName = CANDIDATE.name;
  const candidateBackground = CANDIDATE.background;
  const candidateExperience = (CANDIDATE.experience || []).join('\n- ');

  const prompt = `Write a cover email for ${candidateName} applying to ${job.title} at ${job.company}.

CANDIDATE BACKGROUND:
${candidateBackground}
- ${candidateExperience}
- Notice: ${CANDIDATE.noticePeriod}. Available ${CANDIDATE.availableFrom}.

COMPANY CONTEXT:
${(scoreData.companyIntel || job.company_intel || '').slice(0, 300)}

FOUNDER:
${(scoreData.founderBrief || job.ceo_brief || '').slice(0, 200)}

JD HIGHLIGHTS:
${(job.jd_text || '').slice(0, 600)}

WHY SHE'S INTERESTED:
${scoreData.whyInterested || job.why_interested || ''}

RULES:
- Para 1: One specific thing about what ${job.company} is building (from JD/company intel — be specific, not generic)
- Para 2: Match 2-3 specific JD requirements to her actual experience with real examples
- Para 3: Ask for a 20-minute call. Confident, not desperate.
- Under 200 words. No "I am excited to" opener.
- Sign off: ${candidateName} | ${CANDIDATE.phone} | ${CANDIDATE.email}

FORMAT — reply with exactly:
SUBJECT: [specific subject line]

[email body]`;

  try {
    const res = await axios.post(GROQ_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    }, {
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    const text = res.data?.choices?.[0]?.message?.content || '';
    const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
    const subject = subjectMatch ? subjectMatch[1].trim() : `${job.title} at ${job.company} — ${CANDIDATE.name}`;
    const body = text.replace(/SUBJECT:\s*.+\n?/, '').trim();
    return { subject, body, ok: true };
  } catch (err) {
    console.error('Cover email error:', err.message);
    return {
      subject: `${job.title} at ${job.company} — ${CANDIDATE.name}`,
      body: `Hi,

I came across the ${job.title} role at ${job.company} and wanted to reach out directly.

${CANDIDATE.background}

Would love to connect for a 20-minute call to learn more about the role.

${CANDIDATE.name} | ${CANDIDATE.phone} | ${CANDIDATE.email}`,
      ok: true, fallback: true,
    };
  }
}

export async function sendViaGmailMCP(subject, body, toEmail) {
  // Gmail MCP requires Claude.ai session auth — not available in agent context
  // Return ok:false with authError so dashboard shows copy modal
  return { ok: false, authError: true, error: 'Gmail MCP needs Claude.ai session' };
}
