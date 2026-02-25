// =====================================================================
// K6 FUNNEL PROJECTION — 5,000 SMS leads, realistic funnel narrowing
// Purpose: Prove the dashboard tracks a real funnel accurately in real time
//
// EXPECTED RESULTS (what you should see on the dashboard):
//   website:     5,000 entries  (100%)
//   tutorial:    4,000 entries  (80% of website)
//   webinar:     3,200 entries  (80% of tutorial)
//   contract:    2,880 entries  (90% of webinar)
//   congrats:    2,736 entries  (95% of contract)  + 2,736 completions
//   brand-steps: 2,736 entries  (100% of congrats)
//   Overall conversion: ~54.7%
//
// Run time: ~3-4 minutes
// =====================================================================

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── CONFIG ──────────────────────────────────────────────────────────
const BASE_URL = 'https://apex-tracking-worker.apex-os.workers.dev';
const ORIGIN = 'https://k6-load-test.pages.dev';

// ─── CUSTOM METRICS ─────────────────────────────────────────────────
const stepEntrySuccess = new Rate('step_entry_success');
const stepExitSuccess = new Rate('step_exit_success');
const beaconLatency = new Trend('beacon_latency_ms');
const totalBeacons = new Counter('total_beacons');
const usersReachedEnd = new Counter('users_reached_end');
const usersDropped = new Counter('users_dropped');

// ─── RAMP PROFILE ───────────────────────────────────────────────────
// Fast ramp to 5000 VUs, each VU = one SMS lead going through the funnel
// Ramp takes 30s so all 5000 are active within first minute
export const options = {
  stages: [
    { duration: '15s', target: 2500 },   // First wave of SMS opens
    { duration: '15s', target: 5000 },   // All 5000 leads active
    { duration: '3m',  target: 5000 },   // Sustained — everyone is somewhere in the funnel
    { duration: '30s', target: 0 },      // Cool-down (stragglers finish)
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],           // <2% server errors
    step_entry_success: ['rate>0.97'],        // 97%+ entries succeed
    step_exit_success: ['rate>0.97'],         // 97%+ exits succeed
    beacon_latency_ms: ['p(95)<3000'],        // p95 under 3s
  },
};

// ─── FUNNEL STEPS WITH DROP-OFF ─────────────────────────────────────
// Each step has a pass-through rate. If you don't pass, you drop off.
const STEPS = [
  { page: 'website',     passRate: 0.80, minDwell: 3, maxDwell: 8  },
  { page: 'tutorial',    passRate: 0.80, minDwell: 5, maxDwell: 15 },
  { page: 'webinar',     passRate: 0.90, minDwell: 8, maxDwell: 20, bounceRate: 0.15 },
  { page: 'contract',    passRate: 0.95, minDwell: 3, maxDwell: 8  },
  { page: 'congrats',    passRate: 1.00, minDwell: 2, maxDwell: 5,  hasComplete: true },
  { page: 'brand-steps', passRate: 1.00, minDwell: 3, maxDwell: 10, bounceRate: 0.10 },
];

// ─── HELPERS ────────────────────────────────────────────────────────
function sendBeacon(type, page, sessionId, extra) {
  const payload = {
    type: type,
    page: page,
    session_id: sessionId,
    source: 'sms',
  };
  if (extra) Object.assign(payload, extra);

  const res = http.post(`${BASE_URL}/track`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN,
    },
    timeout: '10s',
  });

  beaconLatency.add(res.timings.duration);
  totalBeacons.add(1);
  return res;
}

// Simulate realistic dwell time with heartbeats every 5s
function dwellOnPage(page, sessionId, minSec, maxSec) {
  const totalTime = minSec + Math.random() * (maxSec - minSec);
  let elapsed = 0;
  while (elapsed < totalTime) {
    const chunk = Math.min(5, totalTime - elapsed);
    sleep(chunk);
    elapsed += chunk;
    // Send heartbeat every 5s (not on final chunk)
    if (elapsed < totalTime) {
      sendBeacon('heartbeat', page, sessionId);
    }
  }
  return Math.round(totalTime * 1000);
}

// Simulate tab-switch bounce (exit then reenter)
function simulateBounce(page, sessionId, timeOnPageMs) {
  sendBeacon('funnel_reexit', page, sessionId, { time_on_page: timeOnPageMs });
  sleep(2 + Math.random() * 5); // away 2-7s
  sendBeacon('funnel_reenter', page, sessionId);
  sleep(3 + Math.random() * 5); // back for 3-8s more
}

// ─── MAIN VU FUNCTION ──────────────────────────────────────────────
// Each VU is one SMS lead walking through the funnel
export default function () {
  const sessionId = `sms-lead-${__VU}-${__ITER}-${Date.now()}`;

  // Only run one iteration per VU — each VU is one unique lead
  if (__ITER > 0) {
    sleep(1);
    return;
  }

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];

    // ── ENTER this step ──
    const enterRes = sendBeacon('funnel_enter', step.page, sessionId);
    const enterOk = check(enterRes, {
      [`${step.page} enter ok`]: (r) => r.status === 200,
    });
    stepEntrySuccess.add(enterOk);

    if (!enterOk) {
      usersDropped.add(1);
      return;
    }

    // ── DWELL on this step (with heartbeats) ──
    const timeOnPage = dwellOnPage(step.page, sessionId, step.minDwell, step.maxDwell);

    // ── BOUNCE simulation (tab switch) ──
    if (step.bounceRate && Math.random() < step.bounceRate) {
      simulateBounce(step.page, sessionId, timeOnPage);
    }

    // ── COMPLETION event (congrats step) ──
    if (step.hasComplete) {
      sendBeacon('funnel_complete', step.page, sessionId);
    }

    // ── DROP-OFF check ──
    if (Math.random() > step.passRate) {
      // User drops off — send exit and stop
      const dropRes = sendBeacon('funnel_exit', step.page, sessionId, { time_on_page: timeOnPage });
      stepExitSuccess.add(dropRes.status === 200);
      usersDropped.add(1);
      return;
    }

    // ── EXIT (proceeding to next step) ──
    const exitRes = sendBeacon('funnel_exit', step.page, sessionId, { time_on_page: timeOnPage });
    const exitOk = check(exitRes, {
      [`${step.page} exit ok`]: (r) => r.status === 200,
    });
    stepExitSuccess.add(exitOk);
  }

  // Made it through all steps!
  usersReachedEnd.add(1);
}
