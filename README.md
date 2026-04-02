# Job Search Assistant

A personal AI agent that finds, scores, and acts on relevant job opportunities. Built for the Leena AI EIR Take-Home Assignment.

## What it does

- **Discovers** live jobs from Adzuna API, LinkedIn, and Naukri simultaneously
- **Enriches** each company with Glassdoor ratings and founder LinkedIn profiles
- **Scores** every job 0-100 across 7 dimensions using Groq AI (temperature=0, deterministic)
- **Routes** to buckets: Skip (0-44), Auto-apply (45-59), Review (60-79), High priority (80+)
- **Acts**: drafts cover emails, files LinkedIn Easy Apply forms, creates Calendar prep blocks

## Quick start

```bash
npm install
npm start
# Open http://localhost:3000
# Test actions: http://localhost:3000/test
```

## Setup

Create `.env`:
```
GROQ_API_KEY=your_groq_key
ADZUNA_APP_ID=your_adzuna_id
ADZUNA_APP_KEY=your_adzuna_key
PORT=3000
```

Get free Groq key: console.groq.com  
Get free Adzuna key: developer.adzuna.com

## Scoring model (100 pts)

| Dimension | Weight | Signal |
|-----------|--------|--------|
| Founder / CEO learning | 25 | Domain credibility, ownership culture |
| Role ownership & decision power | 20 | P&L, CEO access, JD language |
| Sector fit | 17 | AI, fintech, supply chain, consumer |
| Alumni exits & peer quality | 13 | Where did previous hires go next? |
| Culture, stability & WLB | 13 | Glassdoor, funding recency, layoff signals |
| Investor backing | 7 | Tier 1: Peak XV, Accel, Sequoia, YC, Bessemer |
| CTC & comp | 5 | 35L+ base = full marks |
| Location modifier | +5 | Bangalore roles |

## Tech stack

- Node.js v24 (ESM)
- Groq AI — llama-3.3-70b-versatile
- Playwright (Chromium)
- NeDB (embedded database)
- Express.js dashboard

## Live connectors

1. **Adzuna API** — REST, read
2. **LinkedIn** — Playwright scraper, read
3. **Naukri** — Playwright scraper, read
4. **Glassdoor** — Google-first strategy, read
5. **Gmail MCP** — read/write
6. **Google Calendar MCP** — write

## LinkedIn Easy Apply setup

For LinkedIn Easy Apply to work with your logged-in session:
```bash
open -a 'Google Chrome' --args --remote-debugging-port=9222
```

Then click Easy Apply on any LinkedIn job in the dashboard.
