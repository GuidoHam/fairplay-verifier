// Usage: node tests/run-tests.js   (Node >= 19)
// 1) Golden vectors checked firsthand against stake.us/provably-fair/calculation
// 2) Differential test against the independent Python reference (tests/reference.py)
const PF = require('../pf-core.js');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

let pass = 0, fail = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) pass++; else { fail++; console.log(`FAIL ${name}\n  got=${g}\n  exp=${e}`); }
};

(async () => {
  // ---------- 1. Golden vectors (Stake.us calculator, 2026-08-05) ----------
  const S = 'e8df2cc3b9ccb583ce5ea92336842387', C = '83e27f682128eb1852b048203dfd6931';
  eq('stake.us bytes 0..3', (await PF.generateBytes(S, C, 1, 4)), [0xb7, 0x08, 0xca, 0x58]);
  eq('stake.us dice', PF.dice(await PF.generateFloats(S, C, 1, 1)).display, '71.50');
  eq('stake.us limbo raw', PF.limbo(await PF.generateFloats(S, C, 1, 1)).raw, 1.384658144300882);
  eq('stake.us limbo shown', PF.limbo(await PF.generateFloats(S, C, 1, 1)).display, '1.38');
  eq('stake.us mines order', PF.mines(await PF.generateFloats(S, C, 1, 17), 17).tiles,
     [17, 21, 7, 24, 13, 23, 11, 14, 6, 9, 15, 2, 20, 1, 10, 4, 8]);
  eq('stake.us keno', PF.keno(await PF.generateFloats(S, C, 1, 10)), [29, 36, 12, 40, 23, 38, 21, 24, 14, 17]);
  const pl = PF.plinko(await PF.generateFloats(S, C, 1, 8), 8);
  eq('stake.us plinko 8 path', pl.path, 'RRLRRRRR'); eq('stake.us plinko 8 bucket', pl.bucket, 7);
  // Same seeds with leading spaces, exactly as typed into the Stake calculator (engine level, no cleaning)
  eq('stake.us limbo (spaced seeds, nonce 1942124)',
     PF.limbo(await PF.generateFloats(' ' + S, ' ' + C, 1942124, 1)).raw, 1.5831247773805166);

  // ---------- 2. verify() behaviour ----------
  const v = await PF.verify({ game: 'limbo', serverSeed: ' ' + S + '\u200B', clientSeed: C, nonce: '1',
                              serverSeedHash: crypto.createHash('sha256').update(S).digest('hex').toUpperCase() });
  eq('verify cleans seeds + hash ok (uppercase hash)', [v.result.display, v.hashCheck.ok], ['1.38', true]);
  // Stake's calculator does NOT trim: the spaced vector must be reproducible via exactSeeds,
  // and the default (cleaning) path must report that it changed the seeds.
  const sp = await PF.verify({ game: 'limbo', serverSeed: ' ' + S, clientSeed: ' ' + C, nonce: '1942124', exactSeeds: true });
  eq('verify exactSeeds reproduces stake.us spaced vector', [sp.result.raw, sp.cleaned], [1.5831247773805166, { server: false, client: false }]);
  const spc = await PF.verify({ game: 'limbo', serverSeed: ' ' + S, clientSeed: ' ' + C, nonce: '1942124' });
  eq('verify reports cleaned seeds', spc.cleaned, { server: true, client: true });
  const inner = await PF.verify({ game: 'dice', serverSeed: S.slice(0, 10) + '\n' + S.slice(10), clientSeed: C, nonce: 1 });
  eq('verify flags inner line break', inner.innerWhitespace, { server: true, client: false });
  const H = crypto.createHash('sha256').update(S).digest('hex');
  for (const h of ['0x' + H, ' 0X' + H.toUpperCase() + '\n', H.replace(/(.{8})/g, '$1 '), '\u200B' + H]) {
    const r = await PF.verify({ game: 'dice', serverSeed: S, clientSeed: C, nonce: 1, serverSeedHash: h });
    eq('hash normalisation ' + JSON.stringify(h.slice(0, 6)), r.hashCheck.ok, true);
  }
  for (const h of [H.slice(0, 63), H + 'a', 'g'.repeat(64), 'not a hash']) {
    const r = await PF.verify({ game: 'dice', serverSeed: S, clientSeed: C, nonce: 1, serverSeedHash: h });
    eq('invalid hash flagged, not called mismatch ' + JSON.stringify(h.slice(0, 6)), [r.hashCheck.ok, r.hashCheck.invalid], [false, true]);
  }
  const bad = await PF.verify({ game: 'dice', serverSeed: S, clientSeed: C, nonce: 1, serverSeedHash: 'ab'.repeat(32) });
  eq('verify hash mismatch detected', bad.hashCheck.ok, false);
  for (const [o, msg] of [
    [{ game: 'mines', minesCount: 0 }, 'mines 0'], [{ game: 'mines', minesCount: 25 }, 'mines 25'],
    [{ game: 'mines', minesCount: 2.5 }, 'mines 2.5'], [{ game: 'plinko', rows: 7 }, 'rows 7'],
    [{ game: 'plinko', rows: 17 }, 'rows 17'],
    [{ game: 'plinko', rows: '0x10' }, 'rows 0x10'], [{ game: 'plinko', rows: '1e1' }, 'rows 1e1'],
    [{ game: 'plinko', rows: [16] }, 'rows [16]'], [{ game: 'mines', minesCount: '' }, 'mines empty'],
    [{ game: 'mines', minesCount: true }, 'mines true'], [{ game: 'dice', nonce: '' }, 'nonce empty'],
    [{ game: 'dice', nonce: '1.0' }, 'nonce 1.0'], [{ game: 'dice', nonce: '\u0661' }, 'nonce arabic digit'],
    [{ game: 'dice', serverSeed: '\u200B' }, 'invisible-only server'], [{ game: 'dice', nonce: '-1' }, 'nonce -1'],
    [{ game: 'dice', nonce: '1e3' }, 'nonce 1e3'], [{ game: 'dice', nonce: '99999999999999999999' }, 'nonce huge'],
    [{ game: 'dice', serverSeed: '   ' }, 'empty server'], [{ game: 'roulette' }, 'unknown game']]) {
    let threw = false;
    try { await PF.verify({ serverSeed: S, clientSeed: C, nonce: 1, ...o }); } catch { threw = true; }
    eq('rejects ' + msg, threw, true);
  }

  // Deterministic cent-boundary bucket (first k where the double lands just below an exact cent)
  { let k = 0; for (; k < 16777216; k++) { if (PF.limbo([k / 16777216]).atCentBoundary) break; }
    const L = PF.limbo([k / 16777216]);
    eq('limbo cent-boundary bucket flagged and floored', [L.atCentBoundary, (16777216 * 99) % (k + 1)], [true, 0]); }
  { const pr = await PF.verify({ game: 'plinko', serverSeed: S, clientSeed: C, nonce: 1, rows: ' 16 ' });
    eq('plinko 16 rows uses 64 bytes / 2 HMAC rounds', pr.result.path.length, 16);
    const b = await PF.generateBytes(S, C, 1, 64), b0 = await PF.hmacSha256(S, C + ':1:0'), b1 = await PF.hmacSha256(S, C + ':1:1');
    eq('byte cursor crosses round boundary', b, [...b0, ...b1]); }

  // ---------- 3. Differential test vs independent Python reference ----------
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const weird = ['ä', 'Ünïcödé seed', '🎲🎰', 'a:b:c', ' inner space ', 'x'.repeat(300), '0', 'SERVER', '\n'];
  const cases = [];
  let id = 0;
  for (const game of ['dice', 'limbo', 'plinko', 'mines', 'keno']) {
    for (let i = 0; i < 4000; i++) {
      const server = i % 50 === 0 ? weird[i / 50 % weird.length] : rnd(32);
      const client = i % 37 === 0 ? weird[i % weird.length] : rnd(i % 3 === 0 ? 8 : 16);
      const nonce = i < 20 ? i : i % 11 === 0 ? 9007199254740991 - i : crypto.randomInt(0, 2 ** 31);
      cases.push({ id: id++, game, server, client, nonce, rows: 8 + (i % 9), mines: 1 + (i % 24) });
    }
  }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const outLines = execFileSync(py, ['-X', 'utf8', path.join(__dirname, 'reference.py')],
    { input: cases.map((c) => JSON.stringify(c)).join('\n'), maxBuffer: 1 << 28, encoding: 'utf8' }).trim().split('\n');
  const ref = new Map(outLines.map((l) => { const o = JSON.parse(l); return [o.id, o]; }));
  let diffFail = 0, limboUlp = 0;
  for (const c of cases) {
    const r = ref.get(c.id);
    const need = { dice: 1, limbo: 1, keno: 10 }[c.game] || (c.game === 'plinko' ? c.rows : c.mines);
    const f = await PF.generateFloats(c.server, c.client, c.nonce, need);
    let ok;
    if (c.game === 'dice') ok = PF.dice(f).hundredths === r.r;
    else if (c.game === 'limbo') {
      const L = PF.limbo(f);
      // At the 44 cent-boundary buckets the double (what Stake's JS shows) is one cent below the exact
      // value by design; those must be flagged. Everywhere else display must equal the exact math.
      ok = L.display === r.r.shown || (L.atCentBoundary && Math.round(Number(r.r.shown) * 100) - Math.round(Number(L.display) * 100) === 1);
      if (L.raw !== r.r.raw) limboUlp++;                      // JS double rounding vs exact value
      if (Math.abs(L.raw - r.r.raw) / r.r.raw > 4e-16) ok = false;
    } else if (c.game === 'plinko') { const p = PF.plinko(f, c.rows); ok = p.path === r.r.path && p.bucket === r.r.bucket; }
    else if (c.game === 'mines') ok = JSON.stringify(PF.mines(f, c.mines).tiles) === JSON.stringify(r.r);
    else ok = JSON.stringify(PF.keno(f)) === JSON.stringify(r.r);
    if ((await PF.sha256Hex(c.server)) !== r.sha) ok = false;
    if (ok) pass++; else { fail++; if (diffFail++ < 10) console.log('DIFF FAIL', JSON.stringify(c).slice(0, 200), JSON.stringify(r.r).slice(0, 200)); }
  }
  console.log(`differential cases: ${cases.length}, limbo raw values differing by <=1 ulp from exact: ${limboUlp}`);
  console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
})();
