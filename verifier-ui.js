/*!
 * FairPlay Audit — Verifier UI (binds pf-core.js to the page). No network calls.
 * Works on the hub page (game chosen via <select id="game">) and on single-game pages
 * (<div class="card" data-game="limbo">).
 */
(function () {
  'use strict';
  const PF = window.PFCore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const card = document.querySelector('[data-game]') || document.querySelector('.card');
  const fixedGame = card && card.getAttribute('data-game');
  const gameSel = $('game');
  const out = $('out');
  const hint = $('paramHint');
  const currentGame = () => fixedGame || (gameSel && gameSel.value) || 'dice';

  function toggleFields() {
    const g = currentGame();
    if ($('rowsWrap')) $('rowsWrap').style.display = g === 'plinko' ? '' : 'none';
    if ($('minesWrap')) $('minesWrap').style.display = g === 'mines' ? '' : 'none';
    if (!hint) return;
    if (g === 'plinko') { hint.textContent = '⚠️ Set the row count to exactly what the round used (Stake default: 8). A different row count gives a different — but still correct — result.'; hint.classList.add('show'); }
    else if (g === 'mines') { hint.textContent = '⚠️ Set the mine count to exactly what the round used. A different mine count gives a different result.'; hint.classList.add('show'); }
    else hint.classList.remove('show');
  }
  if (gameSel) gameSel.addEventListener('change', toggleFields);
  toggleFields();

  // Short text form of a result (used for the "as typed" alternative).
  function summary(game, R) {
    if (game === 'dice') return R.display;
    if (game === 'limbo') return `${R.display}× (exact ${R.raw})`;
    if (game === 'plinko') return `Bucket ${R.bucket} (${R.path})`;
    if (game === 'mines') return R.tiles.join(', ');
    return R.join(', ');
  }

  // Floats are shown truncated (not rounded), so a value just below 1 never displays as 1.000000.
  const fmtFloat = (x) => (Math.floor(x * 1e10) / 1e10).toFixed(10);

  function render(r, alt) {
    const R = r.result;
    let big = '', extra = '';
    if (r.game === 'dice') big = R.display;
    else if (r.game === 'limbo') {
      big = R.display + '×';
      extra += `<div class="mono">Exact value (Stake calculator "Final Result"): ${esc(R.raw)}</div>`;
      extra += '<div class="mono">The big number is the exact value rounded down to 2 decimals.</div>';
      if (R.atCentBoundary) extra += '<div class="mono">ℹ️ Rare edge case: mathematically this is exactly a whole cent, but computers (and Stake\'s calculator) compute it a hair below. Compare the exact value with Stake\'s calculator.</div>';
    } else if (r.game === 'plinko') {
      big = `Bucket ${esc(R.bucket)}`;
      extra += `<div class="mono">Path: ${esc(R.path)} (L = left, R = right) · ${esc(R.rows)} rows · bucket 0 = far left</div>`;
    } else if (r.game === 'mines') {
      big = `${R.tiles.length} mine${R.tiles.length === 1 ? '' : 's'}`;
      extra += `<div class="mono">Mine tiles in draw order: ${esc(R.tiles.join(', '))}</div>`;
      extra += '<div class="mono">Tile numbers 0–24, the same numbering as Stake\'s calculator ("Number to Shuffle").</div>';
    } else big = esc(R.join(', '));

    let notes = '';
    const which = [r.cleaned.server && 'server seed', r.cleaned.client && 'client seed'].filter(Boolean).join(' and ');
    if (which) {
      notes += `<div class="mono" style="margin-top:8px;color:#d97706">⚠️ We removed leading/trailing spaces or invisible characters from the ${which} (usual copy-paste leftovers). The result above uses the cleaned seed.`;
      if (alt) notes += ` Stake's calculator uses seeds exactly as typed — if your seed really starts or ends with a space, the result with the seed exactly as entered is: <b>${esc(summary(alt.game, alt.result))}</b>`;
      notes += '</div>';
    }
    const inner = [r.innerWhitespace.server && 'server seed', r.innerWhitespace.client && 'client seed'].filter(Boolean).join(' and ');
    if (inner) notes += `<div class="mono" style="margin-top:8px;color:#d97706">⚠️ The ${inner} contains a space or line break in the middle. Seeds are usually one unbroken string — check that the copy-paste didn't break it.</div>`;

    let hashLine = '';
    const hc = r.hashCheck;
    if (hc && hc.invalid) {
      hashLine = '<div class="mono" style="margin-top:8px;color:#d97706">⚠️ The hashed server seed you entered is not a SHA-256 value (64 hex characters), so it was not checked. Copy it again from the casino.</div>';
    } else if (hc && hc.ok) {
      hashLine = '<div class="mono" style="margin-top:8px;color:#16a34a">✅ SHA-256 of this server seed matches the hash you entered — the seed is the one that was committed to before you played.</div>';
    } else if (hc) {
      hashLine = `<div class="mono" style="margin-top:8px;color:#dc2626">❌ SHA-256 of this server seed does NOT match the hash you entered.<br>SHA-256 of this server seed: ${esc(hc.computed)}<br>Check for copy-paste errors first (is it the hash of <i>this</i> seed pair, not the next one?). This check assumes Stake's scheme (hash = SHA-256 of the seed text); if this casino commits differently, a mismatch here proves nothing.</div>`;
    } else {
      hashLine = '<div class="mono" style="margin-top:8px">Tip: paste the hashed server seed too — then we also check that the seed wasn\'t swapped after your bets.</div>';
    }

    out.innerHTML = `<div class="result"><div class="big">${big}</div>${extra}${notes}${hashLine}
      <div class="mono" style="margin-top:8px">Floats (truncated): ${esc(r.floats.map(fmtFloat).join(', '))}</div>
      <div class="mono">HMAC-SHA256( server seed , "${esc(r.clientSeed)}:${esc(r.nonce)}:round" )</div></div>`;
  }

  let runId = 0; // ignore results of an older click if the user clicks again before it finishes
  async function run() {
    const my = ++runId;
    out.innerHTML = '<div class="result">Computing…</div>';
    const opts = {
      game: currentGame(),
      serverSeed: $('server').value,
      clientSeed: $('client').value,
      nonce: $('nonce').value,
      rows: $('rows') ? $('rows').value : '8',
      minesCount: $('mines') ? $('mines').value : '3',
      serverSeedHash: $('hash') ? $('hash').value : '',
    };
    try {
      const r = await PF.verify(opts);
      let alt = null;
      if (r.cleaned.server || r.cleaned.client) {
        try { alt = await PF.verify({ ...opts, exactSeeds: true, serverSeedHash: '' }); } catch (e) { alt = null; }
      }
      if (my === runId) render(r, alt);
    } catch (e) {
      if (my === runId) out.innerHTML = `<div class="result err">Error: ${esc(e.message)}</div>`;
    }
  }
  $('go').addEventListener('click', run);
  for (const id of ['server', 'client', 'hash', 'nonce', 'rows', 'mines']) {
    if ($(id)) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }
})();
