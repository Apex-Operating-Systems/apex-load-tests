// ═══════════════════════════════════════════════════════════════
// APEX LOAD TEST — Full Funnel Flow Simulation
// Simulates real users going through the entire funnel:
//   website → tutorial → webinar → contract → congrats → brand-steps
// Each virtual user enters each step, waits realistic time, then exits
// Realistic drop-off rates at each step
// ═══════════════════════════════════════════════════════════════

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { TRACKING_URL, FUNNEL_STEPS, TIME_ON_PAGE, DROP_OFF_RATES } from '../lib/config.js';

// ── Custom Metrics ──
const entrySuccess = new Rate('funnel_entry_success');
const exitSuccess = new Rate('funnel_exit_success');
const beaconLatency = new Trend('beacon_latency_ms');
const droppedUsers = new Counter('funnel_dropped_users');
const completedUsers = new Counter('funnel_completed_users');

// ── Ramp Profile ──
// Phase 1: Warm-up         →  50 VUs over 2 min
// Phase 2: Steady state    → 500 VUs for 5 min
// Phase 3: Spike ramp      → 2,000 VUs in 30 sec
// Phase 4: Spike hold      → 2,000 VUs for 2 min
// Phase 5: Scale down      → 500 VUs over 1 min
// Phase 6: Sustained       → 500 VUs for 5 min
// Phase 7: Cool-down       → 0 VUs over 2 min
export const options = {
    stages: [
        { duration: '2m',  target: 50 },
        { duration: '5m',  target: 500 },
        { duration: '30s', target: 2000 },
        { duration: '2m',  target: 2000 },
        { duration: '1m',  target: 500 },
        { duration: '5m',  target: 500 },
        { duration: '2m',  target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<3000'],             // 95% under 3s
        http_req_failed: ['rate<0.01'],                 // <1% failure
        funnel_entry_success: ['rate>0.99'],            // 99%+ entries succeed
        funnel_exit_success: ['rate>0.99'],             // 99%+ exits succeed
        beacon_latency_ms: ['p(99)<5000'],              // 99% under 5s
    },
};

function sendBeacon(type, page, sessionId, extraFields) {
    const payload = JSON.stringify({
        type: type,
        page: page,
        session_id: sessionId,
        source: 'k6-load-test',
        ...extraFields,
    });

    const res = http.post(`${TRACKING_URL}/track`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '10s',
    });

    const ok = check(res, {
        'beacon accepted (2xx)': (r) => r.status >= 200 && r.status < 300,
    });

    beaconLatency.add(res.timings.duration);
    return ok;
}

export default function () {
    const sessionId = `k6-${__VU}-${__ITER}-${Date.now()}`;

    for (let i = 0; i < FUNNEL_STEPS.length; i++) {
        const step = FUNNEL_STEPS[i];
        const timeRange = TIME_ON_PAGE[step];

        // Enter step
        const entered = sendBeacon('funnel_enter', step, sessionId);
        entrySuccess.add(entered);

        // Simulate time on page
        const timeOnPage = Math.random() * (timeRange.max - timeRange.min) + timeRange.min;
        // Use a shorter sleep for load testing (1-5 seconds instead of real time)
        sleep(Math.min(timeOnPage, 5));

        // Check drop-off
        if (Math.random() < DROP_OFF_RATES[step] && i < FUNNEL_STEPS.length - 1) {
            // User drops off — send exit, don't continue
            const exited = sendBeacon('funnel_exit', step, sessionId, {
                time_on_page: Math.round(timeOnPage * 1000),
            });
            exitSuccess.add(exited);
            droppedUsers.add(1);
            return;
        }

        // Exit step (moving to next)
        if (i < FUNNEL_STEPS.length - 1) {
            const exited = sendBeacon('funnel_exit', step, sessionId, {
                time_on_page: Math.round(timeOnPage * 1000),
            });
            exitSuccess.add(exited);
        }
    }

    // User completed the entire funnel
    sendBeacon('funnel_complete', 'brand-steps', sessionId);
    completedUsers.add(1);
}
