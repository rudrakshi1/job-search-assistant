/**
 * Google Calendar Action — Phase 2
 * Creates interview prep blocks via Google Calendar MCP
 */

import axios from 'axios';
import 'dotenv/config';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function createInterviewPrepEvent(job, scoreData) {
  const score = scoreData.score || job.score || 0;
  const company = job.company || 'Unknown Company';
  const role = job.title || 'Unknown Role';
  const founderBrief = scoreData.founderBrief || job.ceo_brief || 'Review founder profile on LinkedIn before call.';
  const companyIntel = scoreData.companyIntel || job.company_intel || 'Research company news and recent updates.';
  const whyInterested = scoreData.whyInterested || job.why_interested || '';

  const prepDate = getNextWeekday(new Date());
  prepDate.setHours(8, 0, 0, 0);
  const endDate = new Date(prepDate);
  endDate.setHours(9, 0, 0, 0);

  const eventTitle = `🎯 Prep — ${role} @ ${company} (${score}/100)`;
  const description = [
    `ROLE: ${role} at ${company}`,
    `SCORE: ${score}/100`,
    `JOB URL: ${job.url || 'N/A'}`,
    '',
    '━━ FOUNDER / CEO ━━',
    founderBrief,
    '',
    '━━ COMPANY INTEL ━━',
    companyIntel,
    '',
    '━━ WHY THIS ROLE ━━',
    whyInterested || 'Review scoring breakdown in job agent dashboard.',
    '',
    '━━ PREP CHECKLIST ━━',
    '□ Research founder LinkedIn posts (last 3 months)',
    '□ Review latest company news / product updates',
    '□ Prepare 3 stories: IIT journey, Ola impact, why I build',
    '□ Prepare smart questions about role ownership and vision',
    '□ Know CTC ask — frame as "open to discussion for right role"',
    '□ Have resume and LinkedIn ready',
  ].join('\n');

  try {
    const res = await axios.post(ANTHROPIC_URL, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Create a Google Calendar event:
Title: ${eventTitle}
Start: ${prepDate.toISOString()}
End: ${endDate.toISOString()}
Description: ${description}
Add a 30-minute reminder. Confirm the event was created.`,
      }],
      mcp_servers: [{
        type: 'url',
        url: 'https://gcal.mcp.claude.com/mcp',
        name: 'google-calendar',
      }],
    }, {
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
    });

    const responseText = res.data?.content
      ?.filter(b => b.type === 'text')
      ?.map(b => b.text)
      ?.join('\n') || '';

    return { ok: true, response: responseText, eventTitle, scheduledFor: prepDate.toISOString() };
  } catch (err) {
    const status = err.response?.status;
    return {
      ok: false,
      authError: status === 401,
      eventTitle,
      scheduledFor: prepDate.toISOString(),
      error: status === 401
        ? 'Calendar MCP requires Claude.ai session auth — event details ready to add manually'
        : err.message,
      // Return event details so user can add manually if MCP fails
      manualDetails: { title: eventTitle, description, start: prepDate.toISOString(), end: endDate.toISOString() },
    };
  }
}

function getNextWeekday(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
