import axios from 'axios';
import { CANDIDATE } from '../../config/profile.js';
import 'dotenv/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean);
let _ki = 0;
const getKey = () => { const k = GROQ_KEYS[_ki % GROQ_KEYS.length]; _ki++; return k; };

async function callGroq(prompt) {
  const res = await axios.post(GROQ_URL, {
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, max_tokens: 500,
  }, {
    headers: { 'Authorization': `Bearer ${getKey()}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return res.data?.choices?.[0]?.message?.content || '';
}

export async function classifyEmail(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const categories = {
    interview_invite: ['interview', 'schedule', 'call', 'shortlisted', 'availability', 'zoom', 'meet'],
    offer_letter: ['offer', 'congratulations', 'ctc', 'joining', 'pleased to inform'],
    recruiter_outreach: ['opportunity', 'role', 'opening', 'hiring', 'your profile'],
    application_update: ['application', 'status', 'update', 'under review'],
    rejection: ['not moving forward', 'unsuccessful', 'other candidates', 'regret'],
  };
  for (const [cat, kws] of Object.entries(categories)) {
    if (kws.some(kw => text.includes(kw))) {
      return {
        category: cat,
        requiresAction: ['interview_invite', 'offer_letter', 'recruiter_outreach'].includes(cat),
        urgency: cat === 'offer_letter' ? 'high' : cat === 'interview_invite' ? 'high' : 'medium',
      };
    }
  }
  return { category: 'other', requiresAction: false, urgency: 'low' };
}

export async function draftReply(subject, sender, body, type) {
  const ctx = `${CANDIDATE.name} | ${CANDIDATE.education} | ${CANDIDATE.noticePeriod} | Available: ${CANDIDATE.availableFrom}`;
  const prompts = {
    interview_scheduling: `Draft a professional reply to schedule an interview. Suggest 3 weekday morning/afternoon time slots. Keep it warm and concise. Sign as ${CANDIDATE.name}.\nCandidate context: ${ctx}\nOriginal email: Subject: ${subject} | From: ${sender} | ${body.slice(0, 300)}`,
    recruiter_response: `Draft a warm professional response to a recruiter showing genuine interest. Briefly mention relevant experience. Sign as ${CANDIDATE.name}.\nCandidate context: ${ctx}\nOriginal email: Subject: ${subject} | From: ${sender} | ${body.slice(0, 300)}`,
    follow_up: `Draft a polite follow-up after completing Round 1 with no response for 5 days. Brief and confident. Sign as ${CANDIDATE.name}.\nCandidate context: ${ctx}\nContext: ${subject} | ${sender}`,
  };
  try {
    return await callGroq(prompts[type] || prompts.recruiter_response);
  } catch {
    return `Hi,\n\nThank you for reaching out. I would be happy to discuss this opportunity further.\n\nBest regards,\n${CANDIDATE.name}\n${CANDIDATE.phone}`;
  }
}

export function buildGmailMonitorInstructions() {
  return {
    filters: [
      'subject:(interview OR schedule OR availability) → label: job-interview',
      'subject:(offer OR congratulations OR joining) → label: job-offer',
      'subject:(opportunity OR position OR role) → label: job-recruiter',
    ],
    monitorKeywords: ['interview', 'offer', 'shortlisted', 'opportunity', 'role', 'hiring', 'schedule'],
  };
}
