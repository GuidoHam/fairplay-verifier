/*!
 * FairPlay Audit — Provably Fair Verifier core (Stake-style HMAC-SHA256)
 * https://fairplayaudit.com/verifier/
 *
 * Pure functions, no DOM, no network. Runs in any modern browser (Web Crypto API)
 * and in Node.js >= 19 (globalThis.crypto.subtle).
 *
 * Checked against Stake.us' own calculator (stake.us/provably-fair/calculation) on 2026-08-05:
 * byte stream, Dice, Limbo raw value, Mines draw order, Keno numbers, Plinko directions —
 * see tests/run-tests.js for the vectors. Other casinos are NOT tested.
 */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const subtle = () => {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (!c || !c.subtle) throw new Error('Web Crypto API not available in this environment.');
    return c.subtle;
  };

  // Limits used by Stake for the supported games.
  const LIMITS = Object.freeze({
    plinkoRows: [8, 16],
    minesCount: [1, 24],
    kenoDraws: 10,
  });

  // Characters that are invisible but change the HMAC (common copy-paste artefacts):
  // zero-width space/non-joiner/joiner, word joiner, BOM, soft hyphen.
  const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

  /**
   * Remove surrounding whitespace (incl. NBSP, line breaks) and invisible copy-paste characters.
   * NOTE: Stake's own calculator hashes seeds exactly as typed (a leading space changes the result).
   * verify() therefore reports whether cleaning changed anything, and can run with exactSeeds: true.
   */
  function cleanSeed(s) {
    return String(s).replace(INVISIBLE, '').trim();
  }

  /**
   * Normalise a pasted SHA-256 hash: drop all whitespace/invisible chars and an optional 0x prefix,
   * lowercase. Returns null if the result is not exactly 64 hex characters.
   */
  function normalizeHash(h) {
    let s = String(h).replace(INVISIBLE, '').replace(/\s+/g, '').toLowerCase();
    if (s.startsWith('0x')) s = s.slice(2);
    return /^[0-9a-f]{64}$/.test(s) ? s : null;
  }

  async function hmacSha256(keyStr, msgStr) {
    const key = await subtle().importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle().sign('HMAC', key, enc.encode(msgStr)));
  }

  /** SHA-256 of a UTF-8 string, lowercase hex. Used to check the pre-committed server seed hash. */
  async function sha256Hex(str) {
    const d = new Uint8Array(await subtle().digest('SHA-256', enc.encode(str)));
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Byte stream: HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${round}`),
   * 32 bytes per round, round = floor(cursor / 32).
   */
  async function generateBytes(serverSeed, clientSeed, nonce, count) {
    const out = [];
    let cursor = 0;
    while (out.length < count) {
      const round = Math.floor(cursor / 32);
      const digest = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${round}`);
      for (let i = cursor % 32; i < 32 && out.length < count; i++) {
        out.push(digest[i]);
        cursor++;
      }
    }
    return out;
  }

  /** 4 bytes -> float in [0, 1): b0/256 + b1/256^2 + b2/256^3 + b3/256^4 */
  async function generateFloats(serverSeed, clientSeed, nonce, count) {
    const bytes = await generateBytes(serverSeed, clientSeed, nonce, count * 4);
    const floats = [];
    for (let i = 0; i < count; i++) {
      const [b0, b1, b2, b3] = bytes.slice(i * 4, i * 4 + 4);
      floats.push(b0 / 256 + b1 / 256 ** 2 + b2 / 256 ** 3 + b3 / 256 ** 4);
    }
    return floats;
  }

  // ---------- Games ----------

  /** Dice: roll in [0.00, 100.00]. Returned as integer hundredths to avoid float formatting issues. */
  function dice(floats) {
    const hundredths = Math.floor(floats[0] * 10001);
    return { hundredths, value: hundredths / 100, display: formatHundredths(hundredths) };
  }

  /**
   * Limbo: raw = 16777216 / (floor(f * 16777216) + 1) * 0.99  (Stake's "Raw to Edged" line).
   * `raw` is computed in IEEE-754 doubles exactly like Stake's calculator ("Final Result").
   * `display` = raw rounded DOWN to 2 decimals, never below 1.00.
   * In 44 of the 16,777,216 possible buckets the exact value is a whole cent (e.g. 1.32) but the
   * double lands just below it (1.3199999999999998); `atCentBoundary` flags those cases.
   */
  function limbo(floats) {
    const k = Math.floor(floats[0] * 16777216);
    const raw = (16777216 / (k + 1)) * 0.99;
    const shown = Math.max(Math.floor(raw * 100) / 100, 1);
    // exact check in integers: is 16777216 * 99 / (k + 1) a whole number of cents?
    const atCentBoundary = (16777216 * 99) % (k + 1) === 0 && Math.floor(raw * 100) !== (16777216 * 99) / (k + 1);
    return { raw, display: shown.toFixed(2), atCentBoundary };
  }

  /** Plinko: each float < 0.5 -> Left, else Right. Bucket index (0 = far left) = number of Rights. */
  function plinko(floats, rows) {
    const path = floats.slice(0, rows).map((x) => (x < 0.5 ? 'L' : 'R')).join('');
    return { path, bucket: path.split('').filter((d) => d === 'R').length, rows };
  }

  /** Sequential draw without replacement: idx = floor(f * remaining.length). */
  function drawWithoutReplacement(pool, floats, draws) {
    const rem = pool.slice();
    const picked = [];
    for (let i = 0; i < draws; i++) {
      const idx = Math.floor(floats[i] * rem.length);
      picked.push(rem[idx]);
      rem.splice(idx, 1);
    }
    return picked;
  }

  /**
   * Mines: tiles 0..24, numbered as in Stake's calculator. The first `count` drawn tiles are the mines.
   * (Stake draws all 24 positions; the first `count` of that order are identical.)
   */
  function mines(floats, count) {
    return { tiles: drawWithoutReplacement(Array.from({ length: 25 }, (_, i) => i), floats, count) };
  }

  /** Keno: 10 numbers drawn from 1..40, in draw order. */
  function keno(floats) {
    return drawWithoutReplacement(Array.from({ length: 40 }, (_, i) => i + 1), floats, LIMITS.kenoDraws);
  }

  function formatHundredths(h) {
    return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
  }

  // ---------- Validated entry point ----------

  function intInRange(v, [lo, hi], name) {
    // Only plain decimal digits (or a JS integer) — rejects '0x10', '1e1', '8.5', arrays, booleans.
    const ok = typeof v === 'number' ? Number.isInteger(v) : typeof v === 'string' && /^\d+$/.test(v.trim());
    const n = ok ? Number(typeof v === 'string' ? v.trim() : v) : NaN;
    if (!ok || n < lo || n > hi) throw new Error(`${name} must be a whole number from ${lo} to ${hi}.`);
    return n;
  }

  function parseNonce(v) {
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) throw new Error('Nonce must be a whole number ≥ 0.');
    const n = Number(s);
    if (!Number.isSafeInteger(n)) throw new Error('Nonce is too large.');
    return n;
  }

  /**
   * verify({ game, serverSeed, clientSeed, nonce, rows, minesCount, serverSeedHash, exactSeeds })
   * Returns { game, result, floats, hashCheck, cleaned, innerWhitespace } where hashCheck is
   * null (no hash given), { ok: true, computed }, { ok: false, computed, expected } or
   * { ok: false, invalid: true } (input is not a 64-hex SHA-256 value).
   * cleaned.{server,client}: true if cleanSeed() changed that seed (exactSeeds: true disables cleaning).
   */
  async function verify(opts) {
    const game = String(opts.game);
    const rawServer = String(opts.serverSeed ?? '');
    const rawClient = String(opts.clientSeed ?? '');
    const exact = opts.exactSeeds === true;
    const serverSeed = exact ? rawServer : cleanSeed(rawServer);
    const clientSeed = exact ? rawClient : cleanSeed(rawClient);
    if (!serverSeed.trim() || !clientSeed.trim()) throw new Error('Server seed and client seed are required.');
    const cleaned = { server: serverSeed !== rawServer, client: clientSeed !== rawClient };
    const innerWhitespace = { server: /\s/.test(serverSeed.trim()), client: /\s/.test(clientSeed.trim()) };
    const nonce = parseNonce(opts.nonce);

    let need;
    let rows;
    let minesCount;
    if (game === 'dice' || game === 'limbo') need = 1;
    else if (game === 'plinko') need = rows = intInRange(opts.rows, LIMITS.plinkoRows, 'Plinko rows');
    else if (game === 'mines') need = minesCount = intInRange(opts.minesCount, LIMITS.minesCount, 'Mines count');
    else if (game === 'keno') need = LIMITS.kenoDraws;
    else throw new Error('Unknown game: ' + game);

    let hashCheck = null;
    const hashInput = cleanSeed(opts.serverSeedHash ?? '');
    if (hashInput) {
      const expected = normalizeHash(hashInput);
      const computed = await sha256Hex(serverSeed);
      if (!expected) hashCheck = { ok: false, invalid: true, computed };
      else hashCheck = computed === expected ? { ok: true, computed } : { ok: false, computed, expected };
    }

    const floats = await generateFloats(serverSeed, clientSeed, nonce, need);
    let result;
    if (game === 'dice') result = dice(floats);
    else if (game === 'limbo') result = limbo(floats);
    else if (game === 'plinko') result = plinko(floats, rows);
    else if (game === 'mines') result = mines(floats, minesCount);
    else result = keno(floats);

    return { game, nonce, serverSeed, clientSeed, result, floats, hashCheck, cleaned, innerWhitespace };
  }

  const api = { LIMITS, cleanSeed, normalizeHash, hmacSha256, sha256Hex, generateBytes, generateFloats, dice, limbo, plinko, mines, keno, verify };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFCore = api;
})(typeof self !== 'undefined' ? self : this);
