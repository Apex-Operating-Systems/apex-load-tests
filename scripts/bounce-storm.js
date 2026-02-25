// ═══════════════════════════════════════════════════════════════════════════════
// K6 BOUNCE STORM — Extreme DO live counter stress test
// Spec: K6-JOURNEY-SIMULATION-SPEC.md (Script 4)
// Purpose: Hammer the LiveCounter Durable Objects with rapid enter/exit/reenter
//          cycles to prove atomic counting under extreme concurrency.
//          If ANY race conditions exist, this test will find them.
// ═══════════════════════════════════════════════════════════════════════════════

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = 'https://apex-tracking-worker.apex-os.workers.dev';
const ORIGIN = 'https://k6-load-test.pages.dev';
const STEPS = ['website', 'tutorial', 'webinar', 'contract', 'congrats', 'brand-steps'];

// ─── CUSTOM METRICS ──────────────────────────────────────────────────────────
const enterSuccess = new Rate('enter_success');
const exitSuccess = new Rate('exit_success');
const reenterSuccess = new Rate('reenter_success');
const reexitSuccess = new Rate('reexit_success');
const beaconLatency = new Trend('beacon_latency_ms');
const totalEnters = new Counter('total_enters');
const totalExits = new Counter('total_exits');
const totalReenters = new Counter('total_reenters');
const totalReexits = new Counter('total_reexits');
const totalBounceCycles = new Counter('total_bounce_cycles');

// ─── RAMP PROFILE ────────────────────────────────────────────────────────────
// Aggressive ramp to 3000 VUs, all doing rapid bounce cycles
export const options = {
  stages: [
    { duration: '20s', target: 500 },    // Phase 1: Warm-up
    { duration: '40s', target: 2000 },   // Phase 2: Ramp
    { duration: '3m',  target: 2000 },   // Phase 3: Sustained bombardment
    { duration: '20s', target: 3000 },   // Phase 4: Spike
    { duration: '1m',  target: 3000 },   // Phase 5: Spike hold
    { duration: '30s', target: 0 },      // Phase 6: Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    enter_success: ['rate>0.95'],
    exit_success: ['rate>0.95'],
    reenter_success: ['rate>0.95'],
    reexit_success: ['rate>0.95'],
    beacon_latency_ms: ['p(95)<2000'],
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function sendBeacon(type, page, sessionId, extra) {
  const payload = {
    type: type,
    page: page,
    session_id: sessionId,
    source: 'k6-bounce-storm',
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
  return res;
}

// ─── MAIN VU FUNCTION ───────────────────────────────────────────────────────
// Each VU does: enter → exit → reenter → reexit → reenter → final exit
// This creates maximum churn on the LiveCounter DO for one random step
export default function () {
  const sessionId = `k6-bounce-${__VU}-${__ITER}-${Date.now()}`;
  const page = STEPS[Math.floor(Math.random() * STEPS.length)];

  // ── 1. ENTER ──
  const enterRes = sendBeacon('funnel_enter', page, sessionId);
  check(enterRes, { 'enter ok': (r) => r.status === 200 });
  enterSuccess.add(enterRes.status === 200);
  totalEnters.add(1);
  sleep(0.5 + Math.random() * 1.5); // 0.5-2s on page

  // ── 2. EXIT (first bounce) ──
  const exit1Res = sendBeacon('funnel_exit', page, sessionId, { time_on_page: 2000 });
  check(exit1Res, { 'exit1 ok': (r) => r.status === 200 });
  exitSuccess.add(exit1Res.status === 200);
  totalExits.add(1);
  sleep(0.5 + Math.random() * 2); // away 0.5-2.5s

  // ── 3. REENTER (bounce reversed) ──
  const re1Res = sendBeacon('funnel_reenter', page, sessionId);
  check(re1Res, { 'reenter1 ok': (r) => r.status === 200 });
  reenterSuccess.add(re1Res.status === 200);
  totalReenters.add(1);
  totalBounceCycles.add(1);
  sleep(0.5 + Math.random() * 1.5); // back on page 0.5-2s

  // ── 4. REEXIT (second bounce) ──
  const reexit1Res = sendBeacon('funnel_reexit', page, sessionId, { time_on_page: 1500 });
  check(reexit1Res, { 'reexit1 ok': (r) => r.status === 200 });
  reexitSuccess.add(reexit1Res.status === 200);
  totalReexits.add(1);
  sleep(0.5 + Math.random() * 2); // away again

  // ── 5. REENTER AGAIN (second bounce reversed) ──
  const re2Res = sendBeacon('funnel_reenter', page, sessionId);
  check(re2Res, { 'reenter2 ok': (r) => r.status === 200 });
  reenterSuccess.add(re2Res.status === 200);
  totalReenters.add(1);
  totalBounceCycles.add(1);
  sleep(0.5 + Math.random() * 1); // brief visit

  // ── 6. FINAL EXIT ──
  const finalExitRes = sendBeacon('funnel_exit', page, sessionId, { time_on_page: 5000 });
  check(finalExitRes, { 'final exit ok': (r) => r.status === 200 });
  exitSuccess.add(finalExitRes.status === 200);
  totalExits.add(1);
}
