// Exhaustive check of Limbo for every possible input bucket k = floor(f * 2^24) (16,777,216 cases).
// 1) display must equal floor(raw*100)/100 of the IEEE double (what Stake's own JS computes), min 1.00
// 2) display must equal the exact integer math EXCEPT where atCentBoundary is flagged
// 3) atCentBoundary must be flagged exactly where double and exact math disagree
const PF = require('../pf-core.js');
let bad = 0, flagged = 0;
const fmt = (h) => `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
for (let k = 0; k < 16777216; k++) {
  const L = PF.limbo([k / 16777216]);
  const raw = (16777216 / (k + 1)) * 0.99;
  const viaDouble = fmt(Math.max(Math.floor(raw * 100), 100));
  const exact = fmt(Math.max(Math.floor((16777216 * 99) / (k + 1)), 100));
  if (L.raw !== raw || L.display !== viaDouble) { if (bad++ < 5) console.log('DOUBLE MISMATCH', k, L, viaDouble); }
  const disagree = viaDouble !== exact;
  if (disagree !== L.atCentBoundary) { if (bad++ < 5) console.log('FLAG MISMATCH', k, L, exact); }
  if (L.atCentBoundary) flagged++;
}
console.log(`Limbo exhaustive: 16,777,216 buckets, ${bad} errors, ${flagged} cent-boundary cases flagged`);
process.exit(bad ? 1 : 0);
