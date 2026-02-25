// ═══════════════════════════════════════════════════════════════════════════════
// K6 JOURNEY BLITZ — Compressed full-funnel simulation
// Spec: K6-JOURNEY-SIMULATION-SPEC.md (Script 2)
// Tests: LiveCounter DO atomic counters, FunnelCounter DO, session tracking,
//        bounce reversal, funnel_complete, heartbeats — all at scale
// ═══════════════════════════════════════════════════════════════════════════════

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = 'https://apex-tracking-worker.apex-os.workers.dev';
const ORIGIN = 'https://k6-load-test.pages.dev';

// ─── CUSTOM METRICS ──────────────────────────────────────────────────────────
const entrySuccess = new Rate('funnel_entry_success');
const exitSuccess = new Rate('funnel_exit_success');
const completeSuccess = new Rate('funnel_complete_success');
const heartbeatSuccess = new Rate('heartbeat_success');
const reenterSuccess = new Rate('funnel_reenter_success');
const reexitSuccess = new Rate('funnel_reexit_success');
const beaconLatency = new Trend('beacon_latency_ms');
const totalEntries = new Counter('total_entries');
const totalExits = new Counter('total_exits');
const totalBounces = new Counter('total_bounce_cycles');
const totalCompletes = new Counter('total_funnel_completes');
const totalMissionCompletes = new Counter('total_mission_completes');
const droppedUsers = new Counter('dropped_users');
const fullJourneyUsers = new Counter('full_journey_users');

// ─── RAMP PROFILE ────────────────────────────────────────────────────────────
// Compressed timing: 1-3s per step instead of realistic 5-120s
// This pushes more events per second to stress the system harder
export const options = {
  stages: [
    { duration: '30s', target: 500 },    // Phase 1: Warm-up
    { duration: '1m',  target: 2000 },   // Phase 2: Ramp up
    { duration: '3m',  target: 2000 },   // Phase 3: Sustained load
    { duration: '30s', target: 5000 },   // Phase 4: Spike
    { duration: '2m',  target: 5000 },   // Phase 5: Spike hold
    { duration: '30s', target: 1000 },   // Phase 6: Scale back
    { duration: '1m',  target: 1000 },   // Phase 7: Sustained
    { duration: '30s', target: 0 },      // Phase 8: Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],         // <5% error rate (allowing for rate limits)
    funnel_entry_success: ['rate>0.95'],
    funnel_exit_success: ['rate>0.95'],
    beacon_latency_ms: ['p(95)<2000', 'p(99)<5000'],
  },
};

// ─── FUNNEL STEPS & DROP-OFF RATES ──────────────────────────────────────────
const STEPS = [
  { page: 'website',     minSleep: 1, maxSleep: 3, dropOff: 0.40 },
  { page: 'tutorial',    minSleep: 1, maxSleep: 3, dropOff: 0.30 },
  { page: 'webinar',     minSleep: 2, maxSleep: 4, dropOff: 0.25, bounceRate: 0.20 },
  { page: 'contract',    minSleep: 1, maxSleep: 2, dropOff: 0.10 },
  { page: 'congrats',    minSleep: 0.5, maxSleep: 1.5, dropOff: 0.05, hasComplete: true },
  { page: 'brand-steps', minSleep: 1, maxSleep: 3, dropOff: 0, bounceRate: 0.15, missionCompleteRate: 0.30 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function sendBeacon(type, page, sessionId, extra) {
  const payload = {
    type: type,
    page: page,
    session_id: sessionId,
    source: 'k6-journey-blitz',
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

function dwellOnPage(page, sessionId, minSec, maxSec) {
  const totalTime = minSec + Math.random() * (maxSec - minSec);
  let elapsed = 0;
  while (elapsed < totalTime) {
    const chunk = Math.min(3, totalTime - elapsed);
    sleep(chunk);
    elapsed += chunk;
    if (elapsed < totalTime) {
      const hbRes = sendBeacon('heartbeat', page, sessionId);
      heartbeatSuccess.add(hbRes.status === 200);
    }
  }
  return Math.round(totalTime * 1000);
}

function simulateTabSwitch(page, sessionId, timeOnPageMs) {
  // User switches away
  const exitRes = sendBeacon('funnel_reexit', page, sessionId, { time_on_page: timeOnPageMs });
  reexitSuccess.add(exitRes.status === 200);
  totalBounces.add(1);
  sleep(1 + Math.random() * 3); // away 1-4s (compressed)
  // User comes back
  const reRes = sendBeacon('funnel_reenter', page, sessionId);
  reenterSuccess.add(reRes.status === 200);
  sleep(1 + Math.random() * 2); // watching again 1-3s
}

// ─── MAIN VU FUNCTION ───────────────────────────────────────────────────────
export default function () {
  const sessionId = `k6-blitz-${__VU}-${__ITER}-${Date.now()}`;

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];

    // ── ENTER ──
    const enterRes = sendBeacon('funnel_enter', step.page, sessionId);
    const enterOk = check(enterRes, {
      [`${step.page} enter 200`]: (r) => r.status === 200,
    });
    entrySuccess.add(enterOk);
    totalEntries.add(1);

    if (!enterOk) {
      droppedUsers.add(1);
      return; // Worker returned error — abort journey
    }

    // ── DWELL (with heartbeats) ──
    const timeOnPage = dwellOnPage(step.page, sessionId, step.minSleep, step.maxSleep);

    // ── BOUNCE SIMULATION (tab switch) ──
    if (step.bounceRate && Math.random() < step.bounceRate) {
      simulateTabSwitch(step.page, sessionId, timeOnPage);
    }

    // ── COMPLETION EVENT (congrats or brand-steps) ──
    if (step.hasComplete) {
      const compRes = sendBeacon('funnel_complete', step.page, sessionId);
      completeSuccess.add(compRes.status === 200);
      totalCompletes.add(1);
    }
    if (step.missionCompleteRate && Math.random() < step.missionCompleteRate) {
      const mcRes = sendBeacon('funnel_complete', step.page, sessionId);
      completeSuccess.add(mcRes.status === 200);
      totalMissionCompletes.add(1);
    }

    // ── DROP-OFF CHECK ──
    if (step.dropOff > 0 && Math.random() < step.dropOff) {
      // User drops off — send exit and stop
      const dropRes = sendBeacon('funnel_exit', step.page, sessionId, { time_on_page: timeOnPage });
      exitSuccess.add(dropRes.status === 200);
      totalExits.add(1);
      droppedUsers.add(1);
      return; // Journey ends here
    }

    // ── EXIT (proceeding to next step) ──
    const exitRes = sendBeacon('funnel_exit', step.page, sessionId, { time_on_page: timeOnPage });
    exitSuccess.add(exitRes.status === 200);
    totalExits.add(1);
  }

  // Made it through all steps
  fullJourneyUsers.add(1);
}
