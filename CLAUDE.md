# APEX LOAD TESTS — CLAUDE.md
# Read this first in every session that touches this repo.

## What This Repo Is

k6 load testing scripts for the Apex Operating Systems infrastructure. These scripts simulate hundreds to thousands of concurrent users hitting the tracking worker, dashboard API, and canary worker.

## k6 Binary Location

```bash
/Users/leadfunnelagency/bin/k6
```

Not in $PATH — always use the full path.

## How To Run Tests

```bash
cd /Users/leadfunnelagency/Desktop/apex-load-tests

# ALWAYS run smoke test first — verifies all endpoints are alive
/Users/leadfunnelagency/bin/k6 run scripts/smoke-test.js

# Full funnel simulation (realistic user flow, ramps to 2,000 VUs)
/Users/leadfunnelagency/bin/k6 run scripts/funnel-flow.js

# Pure beacon throughput (ramps to 10,000 VUs)
/Users/leadfunnelagency/bin/k6 run scripts/beacon-stress.js

# D1 write contention (THE critical test — ramps to 2,000 concurrent writers)
/Users/leadfunnelagency/bin/k6 run scripts/d1-contention.js

# Dashboard API stress (ramps to 200 concurrent readers)
/Users/leadfunnelagency/bin/k6 run scripts/dashboard-api.js

# Save results to JSON for later analysis
/Users/leadfunnelagency/bin/k6 run --out json=results/smoke-$(date +%Y%m%d-%H%M).json scripts/smoke-test.js
```

## Test Scripts

| Script | What It Tests | Max VUs | Duration |
|--------|--------------|---------|----------|
| `smoke-test.js` | All endpoints alive, basic sanity | 5 | 1 min |
| `funnel-flow.js` | Full funnel user simulation with drop-offs | 2,000 | ~17 min |
| `beacon-stress.js` | Pure tracking beacon throughput | 10,000 | ~14 min |
| `d1-contention.js` | D1 concurrent write breaking point | 2,000 | ~11 min |
| `dashboard-api.js` | Dashboard API read throughput | 200 | ~13 min |

## Important Notes

- **Run smoke test FIRST** — if smoke fails, don't run bigger tests
- **Reset test data after load tests** — use the dashboard's "Reset Test Data" button to clear k6 noise from funnel stats
- **The tracking worker has rate limiting** — 120 requests/IP/minute on `/track`. k6 runs from a single IP, so very high VU counts may trigger rate limits. This is EXPECTED and a valid finding.
- **All beacons use `source: 'k6-*'`** — you can filter these out in the dashboard API if needed
- **Results go in `results/`** — gitignored, stored locally only

## Related Repos

| Repo | What It Is |
|------|-----------|
| `apex-tracking-worker-v2` | The tracking worker being tested |
| `apex-dashboard-api` | The dashboard API being tested |
| `apex-canary-worker` | The canary worker being tested |
| `apex-system` | CEO Dashboard + funnel pages |

## Git Rules

Same as all Apex repos — see global CLAUDE.md. Branch, commit, push. No exceptions.
