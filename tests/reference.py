"""Independent reference implementation (Python stdlib only) of the Stake-style scheme as shown
by Stake's live calculator (incl. the 2^24 Limbo formula) — deliberately NOT a port of pf-core.js.
It is independent in the arithmetic, but shares the game specification with pf-core.js; only the
Stake golden vectors in run-tests.js protect against a shared specification error. Uses exact integer /
Fraction arithmetic where possible so float-rounding bugs in the JS would show up."""
import hmac, hashlib, json, sys
from fractions import Fraction
from math import floor

def byte_stream(server, client, nonce, count):
    out, rnd = [], 0
    while len(out) < count:
        out += hmac.new(server.encode(), f"{client}:{nonce}:{rnd}".encode(), hashlib.sha256).digest()
        rnd += 1
    return out[:count]

def floats_exact(server, client, nonce, n):
    b = byte_stream(server, client, nonce, 4 * n)
    # exact rational value of each float (b0..b3 as 32-bit big-endian / 2^32)
    return [Fraction(int.from_bytes(bytes(b[4*i:4*i+4]), 'big'), 2**32) for i in range(n)]

def dice(f):            # hundredths
    return floor(f[0] * 10001)

def limbo(f):           # exact rational raw value + floored display
    raw = Fraction(16777216, floor(f[0] * 16777216) + 1) * Fraction(99, 100)
    shown = max(Fraction(floor(raw * 100), 100), Fraction(1))
    return raw, shown

def plinko(f, rows):
    path = ''.join('L' if x < Fraction(1, 2) else 'R' for x in f[:rows])
    return path, path.count('R')

def draw(pool, f, k):
    pool, out = list(pool), []
    for i in range(k):
        out.append(pool.pop(floor(f[i] * len(pool))))
    return out

def mines(f, k): return draw(range(25), f, k)
def keno(f): return draw(range(1, 41), f, 10)

if __name__ == '__main__':
    # read JSON lines of cases from stdin, write results
    for line in sys.stdin:
        c = json.loads(line)
        s, cl, n, g = c['server'], c['client'], c['nonce'], c['game']
        need = {'dice': 1, 'limbo': 1, 'keno': 10}.get(g) or (c['rows'] if g == 'plinko' else c['mines'])
        f = floats_exact(s, cl, n, need)
        if g == 'dice': r = dice(f)
        elif g == 'limbo':
            raw, shown = limbo(f); r = {'raw': float(raw), 'shown': f"{float(shown):.2f}", 'rawExact': str(raw)}
        elif g == 'plinko': p, b = plinko(f, c['rows']); r = {'path': p, 'bucket': b}
        elif g == 'mines': r = mines(f, c['mines'])
        else: r = keno(f)
        print(json.dumps({'id': c['id'], 'r': r, 'sha': hashlib.sha256(s.encode()).hexdigest()}))
