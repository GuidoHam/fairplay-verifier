# Audit summary (5 October 2026)

Before publishing, the verifier was reviewed adversarially (an independent review whose only job was to break it).
Verdict: **water-tight after corrections**. The calculation engine was already correct; the findings were in input handling, the UI and claims on the web pages. All fixed.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Seeds were silently trimmed. Stake's calculator uses seeds exactly as typed, so a seed with a leading space gave a different result than Stake. | The tool now warns when it removed anything and also shows the result for the seed exactly as entered. Inner spaces/line breaks are flagged. |
| 2 | High | A pasted hash with `0x`, spaces or a missing character was reported as "seed does not match" — which reads like an accusation against the casino. | Hashes are normalised; anything that is not 64 hex characters is reported as "not checked", never as a mismatch. A real mismatch states the assumption (SHA-256 of the seed text). |
| 3 | High | The pages claimed compatibility with several other casinos. Only Stake.us was tested. | Removed. Other casinos are only mentioned as "same scheme, not tested by us". |
| 4 | High | A Limbo example comparing two large multipliers was not backed by a firsthand Stake result. | Removed. |
| 5 | Medium | "No server call" was literally wrong (anonymous page-view counter). | Wording fixed: seeds are never sent; the only request is a cookieless page-view counter (path + referrer without query string). |
| 6 | Medium | Hardening. | Referrer stripped of query/fragment; a Content-Security-Policy limits network access to the site's own origin. |
| 7 | Medium | Differential test was flaky in ~1 % of runs (Limbo cent-boundary buckets). | Test accounts for the 44 flagged buckets; deterministic test added. |
| 8 | Low | Loose validation (`0x10`, `1e1` accepted as numbers), floats displayed rounded, double-click race. | Strict decimal validation, floats truncated, run counter. |

## Verified against Stake (firsthand, stake.us calculator, 5 August 2026)
Byte stream (`b7 08 ca 58`), Dice 71.50, Limbo raw value 1.384658144300882 and the spaced-seed vector 1.5831247773805166, Mines draw order and tile numbers as shown in the calculator, Keno numbers as shown in the calculator, Plinko directions for 8 rows. Stake's calculator does not trim seeds.

## Not verified against Stake
Plinko bucket numbering and rows 9–16; how Mines tile numbers map onto the board; whether Keno calculator numbers equal the board labels; whether the Limbo game display rounds down; that the commitment hash is SHA-256 of the seed text; any casino other than Stake.

## Test status
- `node tests/run-tests.js` — 20,044 passed, 0 failed
- `node tests/limbo-exhaustive.js` — 16,777,216 buckets, 0 errors, 44 cent-boundary cases flagged
- `node tests/ui-test.js` — 23 passed, 0 failed; no seed material in any network request
