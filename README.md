# FairPlay Audit — Provably Fair Verifier

Recompute **Stake-style** provably fair results yourself: **Dice, Limbo, Plinko, Mines, Keno**.
Runs 100 % in your browser (Web Crypto API). Your seeds never leave your device.

**Live tool:** https://fairplayaudit.com/verifier/

## Who checks the checker?

A verifier is only useful if it is right. This one was checked against the source, not against other verifiers:

- **Firsthand against Stake's own calculator** (`stake.us/provably-fair/calculation`, 5 August 2026) — all five games matched bit for bit, including the raw bytes, the Limbo "Final Result", the full Mines/Keno draw order and the Plinko directions for 8 rows. The vectors are in [`tests/run-tests.js`](tests/run-tests.js).
- **Against an independent reference** written in Python with exact rational arithmetic ([`tests/reference.py`](tests/reference.py)) — 20,000 random cases including Unicode seeds, very long seeds, nonce 0 and nonces up to 2^53.
- **Limbo exhaustively** — every one of the 16,777,216 possible input buckets ([`tests/limbo-exhaustive.js`](tests/limbo-exhaustive.js)).

Note: Stake's *published* documentation describes Limbo as `1e8 / (float × 1e8) × houseEdge`, while the "Raw to Edged" line of Stake's live calculator shows `16777216 / (floor(float × 16777216) + 1) × 0.99`. The two agree to many decimal places for normal rounds and only drift apart for extremely small floats. This tool follows the live calculator.

## The algorithm

```
bytes  = HMAC_SHA256(key = serverSeed, message = `${clientSeed}:${nonce}:${round}`)   // 32 bytes per round
float  = b0/256 + b1/256² + b2/256³ + b3/256⁴                                         // 4 bytes per float, cursor continues into the next round

Dice   = floor(float × 10001) / 100
Limbo  = 16777216 / (floor(float × 16777216) + 1) × 0.99    // the tool also shows it rounded down to 2 decimals, minimum 1.00×
Plinko = for each row: float < 0.5 → Left, else Right; bucket = number of Rights
Mines  = draw `mines` tiles from 0–24 without replacement: idx = floor(float × remaining)
Keno   = draw 10 numbers from 1–40 without replacement, same rule
```

**Limbo edge case:** in 44 of the 16,777,216 buckets the exact value is a whole cent (e.g. 1.32), but IEEE-754 doubles — and therefore Stake's own JavaScript — land a hair below (1.3199999999999998). The tool shows the exact value and flags these cases.

**Hash check:** paste the *hashed* server seed you saw before playing and the tool checks that `SHA-256(serverSeed)` matches it. For casinos that commit to the SHA-256 of the server seed text (the usual Stake-style scheme), that is what proves the seed was not changed after your bets.

## Run the tests

```
node tests/run-tests.js          # golden vectors + 20,000 differential cases (needs Python 3)
node tests/limbo-exhaustive.js   # all 16,777,216 Limbo buckets
```

Node ≥ 19 (uses `globalThis.crypto.subtle`).

## Scope and honesty

- Verified against **Stake / Stake.us**. Other casinos that use the same Stake-style scheme should give identical results, but each casino can differ in details (house edge, row defaults, numbering). Always compare with the casino's own documentation.
- This tool confirms **one round**. Whether a random number generator is fair over millions of rounds is a different question — that is what our statistical audits at https://fairplayaudit.com are for.
- Not affiliated with Stake or any casino. No affiliate links in this repository.

## What is and isn't verified against Stake

Verified firsthand (Stake.us calculator): bytes/floats, Dice, Limbo "Final Result", Mines and Keno draw order, Plinko directions for 8 rows.

Not verified against Stake, follows from the published scheme: the Plinko bucket numbering and rows 9–16, how Mines tile numbers 0–24 map onto the board, whether the Limbo game display rounds down, that the hash is SHA-256 of the seed text, and every casino other than Stake. See [`AUDIT.md`](AUDIT.md) for the audit summary.

## Files

| File | Purpose |
|---|---|
| `pf-core.js` | Engine: pure functions, no DOM, no network |
| `verifier-ui.js` | Binds the engine to the web page |
| `tests/` | Golden vectors, differential test, exhaustive Limbo test |

## License

MIT — see [`LICENSE`](LICENSE).
