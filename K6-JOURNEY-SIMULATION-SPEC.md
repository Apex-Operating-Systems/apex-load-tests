# K6 FULL JOURNEY SIMULATION — BUILD SPEC
# Item #51 from PROGRESS.md — 500k Simulated Users, Full Funnel Conversion Tracking
# Written: 2026-02-24

---

## THE PROBLEM WITH THE PREVIOUS TEST

The `feat/baseline-scripts` branch has 5 test scripts:

| Script | What It Does | What's Missing |
|--------|-------------|----------------|
| `smoke-test.js` | 5 VUs, hits health endpoints | No funnel journey |
| `funnel-flow.js` | Enter/exit each step with drop-off | No `funnel_complete`, no bounce cycle, no heartbeats, no tab switches, no brand mission completions |
| `beacon-stress.js` | Pure throughput (10k VUs, random enters) | Just random enters — no exits, no conversions, nothing moves on dashboard |
| `d1-contention.js` | All VUs hit same step simultaneously | Tests D1 limits only — no journey |
| `dashboard-api.js` | Hits dashboard endpoints | Reads only — doesn't generate data |

**Result:** Previous tests proved the workers can handle HTTP load, but the CEO Dashboard showed almost nothing because:
1. No `funnel_complete` events fired (congrats conversion = 0%)
2. No `funnel_exit` with `time_on_page` fired (bounce tracking = 0)
3. No `funnel_reenter`/`funnel_reexit` cycle (bounce reversal never tested at scale)
4. No heartbeats (live session counts would drop immediately)
5. Brand missions completions never fired
6. Entries were random (not sequential journey) so conversion rates were meaningless

---

## WHAT THE NEW TEST MUST DO

Each k6 virtual user simulates an **actual ambassador journey** from landing on the website to completing all 10 brand missions. The CEO Dashboard should look like launch day.

### The Full Event Sequence Per Virtual User

```
VU starts with unique session_id

STEP 1 — WEBSITE (page: 'website')
  → POST /track  { type: 'funnel_enter', page: 'website', session_id, source }
  → sleep 5-30s (simulating reading the landing page)
  → POST /track  { type: 'heartbeat', page: 'website', session_id }  (every 15s while on page)
  → [40% DROP OFF HERE → send funnel_exit and stop]
  → POST /track  { type: 'funnel_exit', page: 'website', session_id, time_on_page: <ms> }

STEP 2 — TUTORIAL (page: 'tutorial')
  → POST /track  { type: 'funnel_enter', page: 'tutorial', session_id, source }
  → sleep 10-60s
  → POST /track  { type: 'heartbeat', page: 'tutorial', session_id }  (every 15s)
  → [30% DROP OFF]
  → POST /track  { type: 'funnel_exit', page: 'tutorial', session_id, time_on_page: <ms> }

STEP 3 — WALKTHROUGH/WEBINAR (page: 'webinar')
  → POST /track  { type: 'funnel_enter', page: 'webinar', session_id, source }
  → sleep 30-120s
  → POST /track  { type: 'heartbeat', page: 'webinar', session_id }  (every 15s)
  → [20% BOUNCE SIMULATION: some VUs do tab-switch cycle here]
      → POST /track  { type: 'funnel_exit', page: 'webinar', session_id, time_on_page: <ms> }
      → sleep 5-30s (tab is hidden)
      → POST /track  { type: 'funnel_reenter', page: 'webinar', session_id }
      → sleep 10-30s (watching again)
  → [25% DROP OFF]
  → POST /track  { type: 'funnel_exit', page: 'webinar', session_id, time_on_page: <ms> }

STEP 4 — CONTRACT (page: 'contract')
  → POST /track  { type: 'funnel_enter', page: 'contract', session_id, source }
  → sleep 5-30s (reading contract, filling form)
  → POST /track  { type: 'heartbeat', page: 'contract', session_id }
  → [10% DROP OFF]
  → POST /track  { type: 'funnel_exit', page: 'contract', session_id, time_on_page: <ms> }

STEP 5 — CONGRATS (page: 'congrats')
  → POST /track  { type: 'funnel_enter', page: 'congrats', session_id, source }
  → sleep 2-8s
  → POST /track  { type: 'funnel_complete', page: 'congrats', session_id }
      ^^^ THIS IS THE CONGRATS CONVERSION — fires when they click "Complete Brand Steps"
  → [5% DROP OFF — they see congrats but don't click through]
  → POST /track  { type: 'funnel_exit', page: 'congrats', session_id, time_on_page: <ms> }

STEP 6 — BRAND MISSIONS (page: 'brand-steps')
  → POST /track  { type: 'funnel_enter', page: 'brand-steps', session_id, source }
  → sleep 5-60s (doing missions)
  → POST /track  { type: 'heartbeat', page: 'brand-steps', session_id }  (every 15s)
  → [BOUNCE SIMULATION: 15% do tab-switch cycle]
      → POST /track  { type: 'funnel_exit', page: 'brand-steps', session_id, time_on_page: <ms> }
      → sleep 10-60s
      → POST /track  { type: 'funnel_reenter', page: 'brand-steps', session_id }
      → sleep 10-30s
  → [30% complete all 10 missions]
      → POST /track  { type: 'funnel_complete', page: 'brand-steps', session_id }
          ^^^ THIS IS THE BRAND MISSIONS COMPLETION — fires when all 10 missions done
  → POST /track  { type: 'funnel_exit', page: 'brand-steps', session_id, time_on_page: <ms> }
```

### Two Separate Completion Metrics (CRITICAL — DO NOT MERGE THESE)

| Metric | Event | When It Fires | What It Means |
|--------|-------|---------------|---------------|
| Congrats Conversion | `funnel_complete` page=`congrats` | User clicks "Complete Brand Steps" button on congrats page | They moved from congrats → brand missions |
| Brand Missions Completion | `funnel_complete` page=`brand-steps` | User finishes all 10 missions + clicks FB group join | They completed the entire ambassador program |

These are tracked SEPARATELY in the backend. The dashboard shows them as different metrics. The k6 test must fire them as different events at different times with different rates.

---

## THE SCRIPTS TO BUILD

### Script 1: `scripts/full-journey.js` — The Main Event

**Purpose:** Simulate 500k users going through the full funnel with realistic behavior.

**Ramp profile for 500k total journey starts:**

```
Phase 1: Warm-up        →     100 VUs over 2 min
Phase 2: Ramp up        →   5,000 VUs over 5 min
Phase 3: Sustained load →  10,000 VUs for 10 min
Phase 4: Spike          →  25,000 VUs over 1 min
Phase 5: Spike hold     →  25,000 VUs for 5 min
Phase 6: Scale back     →  10,000 VUs over 2 min
Phase 7: Sustained      →  10,000 VUs for 10 min
Phase 8: Cool-down      →       0 VUs over 3 min
Total run time: ~38 minutes
```

**Each VU = 1 complete journey attempt** (with realistic drop-off at each step).

**Expected dashboard numbers during peak (25k concurrent VUs):**

| Step | Entries | Drop-off | Expected Conversions |
|------|---------|----------|---------------------|
| website | 25,000 | 40% | 15,000 proceed |
| tutorial | 15,000 | 30% | 10,500 proceed |
| webinar | 10,500 | 25% | 7,875 proceed |
| contract | 7,875 | 10% | 7,088 proceed |
| congrats | 7,088 | 5% | 6,733 proceed |
| brand-steps | 6,733 | — | ~2,020 complete all missions (30%) |

**Conversions visible on dashboard:**
- website→tutorial: ~60%
- tutorial→webinar: ~70%
- webinar→contract: ~75%
- contract→congrats: ~90%
- congrats→brand-steps: ~95% (congrats conversion)
- brand missions completion: ~30% of brand-steps entries

**Bounce rates visible on dashboard:**
- webinar: ~20% bounce (tab switch simulation)
- brand-steps: ~15% bounce (tab switch simulation)
- All bounces should reverse when VU "returns" to tab

**Live session counts:**
- Should spike during sustained phases
- Heartbeats keep sessions alive (real sessions expire without heartbeats)

**Custom k6 metrics to track:**

```javascript
// Success rates
const entrySuccess    = new Rate('funnel_entry_success');
const exitSuccess     = new Rate('funnel_exit_success');
const completeSuccess = new Rate('funnel_complete_success');
const heartbeatSuccess = new Rate('heartbeat_success');
const reenterSuccess  = new Rate('funnel_reenter_success');
const reexitSuccess   = new Rate('funnel_reexit_success');

// Latency
const beaconLatency   = new Trend('beacon_latency_ms');

// Funnel counts
const totalEntries    = new Counter('total_entries');
const totalExits      = new Counter('total_exits');
const totalBounces    = new Counter('total_bounce_cycles');  // tab switch out+in
const totalCompletes  = new Counter('total_funnel_completes');  // congrats completions
const totalMissionCompletes = new Counter('total_mission_completes');  // brand-steps completions
const droppedUsers    = new Counter('dropped_users');
const fullJourneyUsers = new Counter('full_journey_users');  // made it to brand-steps

// Thresholds
thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    funnel_entry_success: ['rate>0.99'],
    funnel_exit_success: ['rate>0.99'],
    funnel_complete_success: ['rate>0.99'],
    beacon_latency_ms: ['p(95)<2000', 'p(99)<5000'],
}
```

**Key implementation details:**

1. **Session ID format:** `k6-journey-{VU_ID}-{ITER}-{timestamp}` — must be unique per journey
2. **Source field:** `'k6-full-journey'` — so we can filter test data from real data
3. **Heartbeats:** Send every 15s while "on page" — use k6 `sleep()` in chunks:
   ```javascript
   function dwellOnPage(page, sessionId, minSec, maxSec) {
       const totalTime = minSec + Math.random() * (maxSec - minSec);
       let elapsed = 0;
       while (elapsed < totalTime) {
           const chunk = Math.min(15, totalTime - elapsed);
           sleep(chunk);
           elapsed += chunk;
           if (elapsed < totalTime) {
               sendBeacon('heartbeat', page, sessionId);
           }
       }
       return Math.round(totalTime * 1000); // return ms for time_on_page
   }
   ```
4. **Tab-switch bounce simulation:**
   ```javascript
   function simulateTabSwitch(page, sessionId, timeOnPageMs) {
       // User switches away (tab hidden)
       sendBeacon('funnel_exit', page, sessionId, { time_on_page: timeOnPageMs });
       sleep(5 + Math.random() * 25);  // away for 5-30s
       // User comes back (tab visible)
       sendBeacon('funnel_reenter', page, sessionId);
       // Continue watching
       const extraTime = 10 + Math.random() * 20;
       sleep(extraTime);
       return Math.round(extraTime * 1000); // additional time
   }
   ```
5. **Drop-off must send `funnel_exit`** before stopping (real users trigger visibilitychange/beforeunload)
6. **Content-Type:** Always `application/json`
7. **Origin header:** `https://k6-load-test.pages.dev` (or actual GHL origin if CORS matters)

### Script 2: `scripts/journey-blitz.js` — Speed Run (Compressed Timing)

**Purpose:** Same journey logic as `full-journey.js` but with compressed sleep times (1-3s per step instead of realistic 5-120s). This allows testing at higher VU counts with less wallclock time.

**Why:** At 25k VUs with realistic sleep times, each VU ties up a k6 goroutine for minutes. The blitz version pushes events faster so we can simulate more total journeys in less time.

**Ramp profile:**
```
Phase 1: Warm-up    →   500 VUs over 1 min
Phase 2: Ramp       → 5,000 VUs over 2 min
Phase 3: Sustained  → 5,000 VUs for 5 min
Phase 4: Spike      → 15,000 VUs over 30s
Phase 5: Spike hold → 15,000 VUs for 3 min
Phase 6: Cool-down  →     0 VUs over 1 min
Total: ~12.5 minutes
```

**Differences from full-journey.js:**
- Sleep 1-3s per step instead of realistic times
- Heartbeats every 3s (still proportional)
- Same drop-off rates and bounce simulation
- Same completion events
- `source: 'k6-journey-blitz'`

### Script 3: `scripts/conversion-soak.js` — Sustained Conversion Pressure

**Purpose:** Moderate VU count (1,000) running for 30+ minutes. Tests that conversions, bounces, and completions are counted correctly over a long period without drift or counter corruption.

**What it validates:**
- KV funnel stats don't corrupt under sustained writes
- D1 doesn't run out of write capacity
- Durable Object shards balance correctly
- Bounce pending keys expire and clean up properly
- Dashboard conversion percentages stay stable (not drifting over time)
- Live session counts don't leak (sessions that exit should decrement)

**Ramp profile:**
```
Phase 1: Ramp      → 1,000 VUs over 2 min
Phase 2: Sustained → 1,000 VUs for 30 min
Phase 3: Cool-down →     0 VUs over 2 min
Total: ~34 minutes
```

### Script 4: `scripts/bounce-storm.js` — Bounce Cycle Stress Test

**Purpose:** Specifically tests the bounce/unbounce cycle under extreme concurrency. Every VU enters a page, exits (bounce), re-enters (unbounce), re-exits (re-bounce), re-enters again (unbounce) — rapid-fire.

**Why this matters:** The bounce reversal logic touches KV read + write + delete + D1 write + DO method call. If any of these race conditions exist, this test will find them.

**Behavior per VU:**
```
1. funnel_enter (page: random step)
2. sleep 2s
3. funnel_exit  → bounce recorded
4. sleep 1-5s
5. funnel_reenter → bounce reversed
6. sleep 2s
7. funnel_reexit  → bounce re-recorded
8. sleep 1-5s
9. funnel_reenter → bounce reversed again
10. sleep 2s
11. funnel_exit (final — user leaves)
```

**Expected result:** After test completes and all VUs exit, net bounce count for each step should be close to the number of VUs that did the final `funnel_exit` (step 11) without a subsequent reenter. This validates the bounce counter isn't drifting.

**Ramp profile:**
```
Phase 1: Ramp       →  500 VUs over 1 min
Phase 2: Sustained  → 2,000 VUs for 5 min
Phase 3: Spike      → 5,000 VUs for 2 min
Phase 4: Cool-down  →     0 VUs over 1 min
Total: ~9 minutes
```

### Script 5: `scripts/dashboard-under-load.js` — Dashboard Reads During Writes

**Purpose:** Run alongside `full-journey.js` to hit the dashboard API while the tracking worker is under heavy write load. This simulates Ben/Vinny watching the dashboard during launch.

**What it does:**
- Hits `/funnel` every 5s (the main dashboard endpoint)
- Hits `/stats` every 10s (live session counts)
- Hits `/health` every 30s
- Validates response times stay under 3s even during heavy write load
- Validates the returned funnel data has entries > 0 (data is actually flowing)

```javascript
// Validate data is actually moving
check(funnelRes, {
    'funnel data has entries': (r) => {
        const data = JSON.parse(r.body);
        const steps = data.steps || data.funnel?.steps || {};
        return (steps.website?.entries || 0) > 0;
    },
    'conversion rates present': (r) => {
        const data = JSON.parse(r.body);
        return data.conversions !== undefined || data.conversion_rates !== undefined;
    },
});
```

---

## CONFIGURATION UPDATES (`lib/config.js`)

The existing config needs these additions:

```javascript
// Existing (keep)
export const TRACKING_URL = 'https://apex-tracking-worker.apex-os.workers.dev';
export const DASHBOARD_API_URL = 'https://apex-dashboard-api.apex-os.workers.dev';
export const CANARY_URL = 'https://apex-canary-worker.apex-os.workers.dev';
export const FUNNEL_STEPS = ['website', 'tutorial', 'webinar', 'contract', 'congrats', 'brand-steps'];

// NEW — Drop-off rates (% who DON'T continue to next step)
export const DROP_OFF_RATES = {
    'website': 0.40,
    'tutorial': 0.30,
    'webinar': 0.25,
    'contract': 0.10,
    'congrats': 0.05,
    'brand-steps': 0.0,
};

// NEW — Realistic dwell times per step (seconds)
export const DWELL_TIMES = {
    'website':     { min: 5,  max: 30 },
    'tutorial':    { min: 10, max: 60 },
    'webinar':     { min: 30, max: 120 },
    'contract':    { min: 5,  max: 30 },
    'congrats':    { min: 2,  max: 8 },
    'brand-steps': { min: 5,  max: 60 },
};

// NEW — Compressed dwell times for blitz mode (seconds)
export const BLITZ_DWELL_TIMES = {
    'website':     { min: 1, max: 2 },
    'tutorial':    { min: 1, max: 3 },
    'webinar':     { min: 2, max: 4 },
    'contract':    { min: 1, max: 2 },
    'congrats':    { min: 0.5, max: 1 },
    'brand-steps': { min: 1, max: 3 },
};

// NEW — Bounce simulation rates (% of VUs that do tab-switch on this step)
export const BOUNCE_RATES = {
    'website': 0.10,
    'tutorial': 0.10,
    'webinar': 0.20,      // highest — people get distracted during webinar
    'contract': 0.05,
    'congrats': 0.02,
    'brand-steps': 0.15,  // people leave and come back during missions
};

// NEW — Brand missions completion rate (% of brand-steps entrants who complete all 10)
export const MISSION_COMPLETION_RATE = 0.30;

// NEW — Heartbeat interval (seconds)
export const HEARTBEAT_INTERVAL = 15;

// NEW — source tags for filtering test data
export const SOURCES = {
    JOURNEY: 'k6-full-journey',
    BLITZ: 'k6-journey-blitz',
    SOAK: 'k6-conversion-soak',
    BOUNCE: 'k6-bounce-storm',
};
```

---

## SHARED HELPER LIBRARY (`lib/journey-helpers.js`)

All journey scripts share these helpers:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { TRACKING_URL, HEARTBEAT_INTERVAL } from './config.js';

/**
 * Send a tracking beacon to the tracking worker.
 * Returns true if accepted (2xx), false otherwise.
 */
export function sendBeacon(type, page, sessionId, source, extraFields = {}) {
    const payload = JSON.stringify({
        type,
        page,
        session_id: sessionId,
        source,
        ...extraFields,
    });

    const res = http.post(`${TRACKING_URL}/track`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '10s',
    });

    return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        duration: res.timings.duration,
        body: res.body,
    };
}

/**
 * Simulate dwelling on a page with periodic heartbeats.
 * Returns total dwell time in milliseconds.
 */
export function dwellOnPage(page, sessionId, source, minSec, maxSec) {
    const totalTime = minSec + Math.random() * (maxSec - minSec);
    let elapsed = 0;

    while (elapsed < totalTime) {
        const chunk = Math.min(HEARTBEAT_INTERVAL, totalTime - elapsed);
        sleep(chunk);
        elapsed += chunk;

        // Send heartbeat if we have more time left (don't heartbeat at the very end)
        if (elapsed < totalTime) {
            sendBeacon('heartbeat', page, sessionId, source);
        }
    }

    return Math.round(totalTime * 1000);
}

/**
 * Simulate a tab-switch bounce cycle.
 * 1. Exit (bounce recorded)
 * 2. Sleep (tab hidden)
 * 3. Reenter (bounce reversed)
 * 4. Sleep (watching again)
 * Returns additional time spent in ms.
 */
export function simulateTabSwitch(page, sessionId, source, timeOnPageMs) {
    // Tab switch away
    sendBeacon('funnel_exit', page, sessionId, source, { time_on_page: timeOnPageMs });

    // Time away (5-30s)
    const awayTime = 5 + Math.random() * 25;
    sleep(awayTime);

    // Come back
    sendBeacon('funnel_reenter', page, sessionId, source);

    // Continue on page
    const extraTime = 10 + Math.random() * 20;
    sleep(extraTime);

    return Math.round(extraTime * 1000);
}

/**
 * Simulate a rapid bounce cycle (for bounce-storm test).
 * exit → reenter → reexit → reenter → final exit
 */
export function rapidBounceSequence(page, sessionId, source) {
    const timeOnPage = 2000; // 2s simulated

    // 1. First exit (bounce)
    sendBeacon('funnel_exit', page, sessionId, source, { time_on_page: timeOnPage });
    sleep(1 + Math.random() * 4);

    // 2. Reenter (unbounce)
    sendBeacon('funnel_reenter', page, sessionId, source);
    sleep(2);

    // 3. Re-exit (re-bounce via reexit)
    sendBeacon('funnel_reexit', page, sessionId, source);
    sleep(1 + Math.random() * 4);

    // 4. Reenter again (unbounce again)
    sendBeacon('funnel_reenter', page, sessionId, source);
    sleep(2);

    // 5. Final exit (bounce stays — user actually leaves)
    sendBeacon('funnel_reexit', page, sessionId, source);
}
```

---

## HOW TO RUN

### Pre-flight checklist (BEFORE running any test):

1. **Smoke test first** — always:
   ```bash
   /Users/leadfunnelagency/bin/k6 run scripts/smoke-test.js
   ```
   If this fails, don't run anything else.

2. **Check dashboard is accessible** — open CEO Dashboard, confirm it loads

3. **Note current funnel numbers** — screenshot the dashboard before test starts so you can see the delta

4. **Decide: staging or production?**
   - Staging: Change `TRACKING_URL` in config.js to staging worker URL
   - Production: Use production URLs but understand the data will mix with real user data
   - Recommendation: Use a `source` filter. All test events have `source: 'k6-*'` which can be filtered out of real analytics later. Or: create a dedicated test KV namespace.

### Run order for the full 500k test:

```bash
# Step 1: Smoke test (1 minute)
/Users/leadfunnelagency/bin/k6 run scripts/smoke-test.js

# Step 2: Bounce storm — validate bounce cycle works at scale (9 minutes)
/Users/leadfunnelagency/bin/k6 run scripts/bounce-storm.js

# Step 3: Dashboard reads alongside journey writes (run in parallel)
# Terminal 1:
/Users/leadfunnelagency/bin/k6 run scripts/full-journey.js
# Terminal 2 (simultaneously):
/Users/leadfunnelagency/bin/k6 run scripts/dashboard-under-load.js

# Step 4: (Optional) Soak test for counter integrity (34 minutes)
/Users/leadfunnelagency/bin/k6 run scripts/conversion-soak.js

# Step 5: (Optional) Blitz for max throughput (12.5 minutes)
/Users/leadfunnelagency/bin/k6 run scripts/journey-blitz.js
```

### What to watch during the test:

| Where | What To Look For |
|-------|-----------------|
| CEO Dashboard | Entries climbing at every step, conversion % between steps, live session count, bounces moving |
| k6 terminal | Request rate (req/s), p95 latency, failure rate, custom metric counters |
| Cloudflare Dashboard | Worker CPU time, request count, error rate, KV ops, D1 row writes |
| Canary Worker `/system-health` | All probes green, no circuit breakers tripping |

### What success looks like:

- **p95 latency < 3s** on all beacon types
- **< 1% HTTP failures** across all requests
- **Dashboard shows realistic funnel** — entries at each step, conversion rates between 60-95% depending on step
- **Congrats conversion > 0%** — proves `funnel_complete` on congrats page works
- **Brand missions completion showing** — proves `funnel_complete` on brand-steps works
- **Bounce counts move up and down** — proves bounce/unbounce cycle works under load
- **Live session count tracks VU count** — proves heartbeats keep sessions alive
- **No D1 errors in Cloudflare logs** — proves write capacity holds
- **No DLQ messages** — proves no events are being dead-lettered
- **Counter integrity** — final funnel stats entries should roughly match `total VUs * (1 - cumulative drop-off)` for each step

---

## DATA CLEANUP AFTER TESTING

After a test run against production, the funnel data will contain test entries. Options:

1. **Filter by source** — Test events all have `source: 'k6-*'`. The dashboard could add a filter to exclude these. (Requires small dashboard API change.)
2. **Reset day's stats** — If testing on a non-launch day, the daily KV key `funnel:{date}` can be deleted to reset.
3. **Use staging** — Test against staging workers so production data stays clean.

Recommended approach: Run all tests against production URLs on a **non-launch day** so we see real Cloudflare infrastructure behavior, then delete the day's KV data before launch day.

---

## FILES TO CREATE

```
apex-load-tests/
├── lib/
│   ├── config.js              (UPDATE — add new constants)
│   └── journey-helpers.js     (NEW — shared beacon/dwell/bounce helpers)
├── scripts/
│   ├── smoke-test.js          (KEEP — from baseline branch)
│   ├── funnel-flow.js         (REPLACE — superseded by full-journey.js)
│   ├── beacon-stress.js       (KEEP — still useful for pure throughput)
│   ├── d1-contention.js       (KEEP — still useful for D1 limits)
│   ├── dashboard-api.js       (REPLACE — superseded by dashboard-under-load.js)
│   ├── full-journey.js        (NEW — main 500k journey simulation)
│   ├── journey-blitz.js       (NEW — compressed timing speed run)
│   ├── conversion-soak.js     (NEW — 30min sustained conversion test)
│   ├── bounce-storm.js        (NEW — bounce cycle stress test)
│   └── dashboard-under-load.js (NEW — dashboard reads during write load)
├── K6-JOURNEY-SIMULATION-SPEC.md  (THIS FILE)
├── CLAUDE.md
└── README.md
```

---

## DEPENDENCIES

- **k6 binary:** `/Users/leadfunnelagency/bin/k6` (already installed)
- **No other dependencies** — k6 is standalone, no npm install needed
- **Network:** Must be able to reach `*.apex-os.workers.dev` endpoints
- **Machine:** k6 at 25k VUs needs a decent machine. If local laptop can't handle it, consider k6 Cloud or a beefy EC2/GCP instance.

---

## ESTIMATED VU REQUIREMENTS

For 500,000 total journey starts:

| Script | Peak VUs | Duration | Total Journeys |
|--------|----------|----------|---------------|
| full-journey.js | 25,000 | ~38 min | ~300,000-500,000 (depends on iteration speed) |
| journey-blitz.js | 15,000 | ~12.5 min | ~200,000-400,000 (faster iterations) |
| bounce-storm.js | 5,000 | ~9 min | N/A (bounce cycles, not full journeys) |
| conversion-soak.js | 1,000 | ~34 min | ~50,000 |

Note: k6 VUs iterate — each VU runs the default function in a loop. So 10,000 VUs running for 10 minutes with ~30s per iteration = ~200,000 total journey attempts. Adjust ramp profile to hit 500k target.

---

## WHAT THE CEO DASHBOARD SHOULD SHOW DURING A 25K VU PEAK

```
LIVE SESSIONS: ~15,000-20,000 (spread across steps)

FUNNEL:
  website     → 25,000 entries  | 10,000 bounces cycling
  tutorial    → 15,000 entries  | 1,500 bounces
  webinar     → 10,500 entries  | 2,100 bounces (highest bounce rate)
  contract    →  7,875 entries  | 394 bounces
  congrats    →  7,088 entries  | 142 bounces
  brand-steps →  6,733 entries  | 1,010 bounces

CONVERSIONS:
  website → tutorial:     60%
  tutorial → webinar:     70%
  webinar → contract:     75%
  contract → congrats:    90%
  congrats → brand-steps: 95%  ← CONGRATS CONVERSION (was broken, now fixed)

BRAND MISSIONS COMPLETED: ~2,020 (30% of brand-steps entries)

BOUNCE RATES: Fluctuating in real-time as VUs switch tabs and return
```

This is what launch day looks like. If the test shows these numbers and the system holds, we're ready.
