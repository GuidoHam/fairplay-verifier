// Browser test. Serve the site so that the verifier pages are under BASE_URL, then:
//   CHROME_PATH=/path/to/chrome BASE_URL=http://127.0.0.1:8791/verifier/ node tests/ui-test.js
// Needs: npm install (puppeteer-core).
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const S = 'e8df2cc3b9ccb583ce5ea92336842387', C = '83e27f682128eb1852b048203dfd6931';
const H = crypto.createHash('sha256').update(S).digest('hex');
const base = process.env.BASE_URL || 'http://127.0.0.1:8791/verifier/';
const ORIGIN = new URL(base).origin;
const cases = [
  ['dice/', {}, ['71.50', '✅']],
  ['limbo/', {}, ['1.38×', '1.384658144300882', '✅']],
  ['mines/', { mines: '17' }, ['17 mines', '17, 21, 7, 24, 13, 23, 11, 14, 6, 9, 15, 2, 20, 1, 10, 4, 8', '✅']],
  ['keno/', {}, ['29, 36, 12, 40, 23, 38, 21, 24, 14, 17', '✅']],
  ['plinko/', { rows: '8' }, ['Bucket 7', 'RRLRRRRR', '✅']],
  ['', { game: 'limbo' }, ['1.38×', '✅']],
  ['', { game: 'mines', mines: '3' }, ['17, 21, 7', '✅']],
  ['', { game: 'plinko', rows: '8' }, ['Bucket 7']],
  ['limbo/', { hash: 'ab'.repeat(32) }, ['❌']],
  ['limbo/', { nonce: '1e3' }, ['Error: Nonce']],
  ['mines/', { mines: '25' }, ['Error: Mines count']],
  ['plinko/', { rows: '20' }, ['Error: Plinko rows']],
  ['dice/', { server: '' }, ['Error: Server seed']],
  ['dice/', { server: '  ' + S + '\u200B ', hash: ' ' + H.toUpperCase() + ' ' }, ['71.50', '✅']],
  ['keno/', { client: '<img src=x onerror=alert(1)>' }, ['&lt;img'] ],
  ['dice/', { hash: '0x' + H.toUpperCase() }, ['71.50', '✅']],
  ['dice/', { hash: H.slice(1) }, ['71.50', 'not a SHA-256 value']],
  ['limbo/', { server: ' ' + S, client: ' ' + C, nonce: '1942124', hash: '' }, ['removed leading/trailing', '1.5831247773805166']],
  ['', { game: 'limbo', server: ' ' + S, client: ' ' + C, nonce: '1942124', hash: '' }, ['1.5831247773805166']],
  ['dice/', { server: S.slice(0, 9) + ' ' + S.slice(9), hash: '' }, ['space or line break in the middle']],
  ['mines/', { mines: '0x10' }, ['Error: Mines count']],
  ['plinko/', { rows: '16' }, ['Bucket', '16 rows']],
  ['dice/', { client: 'x'.repeat(200000), hash: '' }, ['Floats']],
];
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  let pass = 0, fail = 0, leaks = 0; const errors = [], beacons = [], pending = [];
  for (const [path, o, expects] of cases) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    page.on('pageerror', (e) => errors.push(path + ' ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/api\/hit/.test((m.location() || {}).url || '') && !/favicon.ico/.test((m.location() || {}).url || '')) errors.push(path + ' console: ' + m.text()); });
    // Privacy: no request may carry seed material; CSP must not block anything of ours.
    page.on('request', (req) => pending.push((async () => {
      let body = req.postData() || '';
      if (!body && req.hasPostData()) body = (await req.fetchPostData().catch(() => '')) || '';
      const blob = req.url() + ' ' + body;
      if (blob.includes(S.slice(0, 12)) || blob.includes(C.slice(0, 12)) || blob.includes('xxxxxxxxxx')) { leaks++; console.log('LEAK', req.url(), body.slice(0, 120)); }
      if (/api\/hit/.test(req.url())) beacons.push(body);
      else if (new URL(req.url()).origin !== ORIGIN) { leaks++; console.log('EXTERNAL REQUEST', req.url()); }
    })()));
    await page.goto(base + path, { waitUntil: 'networkidle0' });
    if (o.game) await page.select('#game', o.game);
    const set = async (id, v) => page.$eval('#' + id, (el, v) => { el.value = v; }, v);
    await set('server', o.server ?? S); await set('client', o.client ?? C);
    await set('nonce', o.nonce ?? '1'); await set('hash', o.hash ?? H);
    if (o.rows && await page.$('#rows')) await set('rows', o.rows);
    if (o.mines && await page.$('#mines')) await set('mines', o.mines);
    await page.click('#go');
    await page.waitForFunction(() => !document.getElementById('out').textContent.includes('Computing'), { timeout: 5000 });
    const html = await page.$eval('#out', (el) => el.innerHTML);
    const missing = expects.filter((e) => !html.includes(e));
    if (missing.length) { fail++; console.log('FAIL', path, JSON.stringify(o).slice(0, 80), 'missing', missing, '\n   ', html.replace(/\s+/g, ' ').slice(0, 300)); } else pass++;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) { fail++; console.log('FAIL horizontal overflow on mobile', path); }
    await Promise.all(pending);
    await page.close();
  }
  await browser.close();
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'no JS errors');
  const badBeacon = beacons.filter((b) => { try { const o = JSON.parse(b); return Object.keys(o).join() !== 'p,r' || /[?#]/.test(o.r); } catch { return true; } });
  console.log(`beacons: ${beacons.length}, malformed: ${badBeacon.length}, seed leaks: ${leaks}`);
  if (leaks || badBeacon.length || !beacons.length || errors.length) fail++;
  console.log(`UI: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
