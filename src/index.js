import 'dotenv/config';
import { initDB } from './tracker/db.js';
import { startDashboard } from './dashboard/server.js';

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Job Search Agent                       ║');
  console.log('║   Phase 1  ·  Deadline: May 15, 2026     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await initDB();
  console.log('✓ Database ready\n');

  console.log('📊 Scoring model (100 pts):');
  console.log('   25 — Learning from founder / CEO');
  console.log('   20 — Role ownership & decision power');
  console.log('   17 — Sector fit  (AI / fintech / SC / consumer)');
  console.log('   13 — Alumni exits & peer quality');
  console.log('   13 — Culture, stability & WLB');
  console.log('    7 — Investor backing');
  console.log('    5 — CTC & comp  (+5 Bangalore modifier)\n');

  console.log('🛡  Guardrail tiers:');
  console.log('   0-44  → Skip / Reject');
  console.log('   45-59 → Auto-apply (all fields pre-filled, review before submit)');
  console.log('   60-79 → Review required (must approve answers)');
  console.log('   80+   → High priority — always manual\n');

  startDashboard();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
