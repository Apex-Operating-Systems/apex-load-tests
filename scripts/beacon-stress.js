// ═══════════════════════════════════════════════════════════════
// APEX LOAD TEST — Tracking Beacon Stress Test
// Pure throughput test: how many beacons/second can the tracking
// worker handle before it starts dropping requests?
// Ramps to 10,000 concurrent virtual users sending beacons
// ═══════════════════════════════════════════════════════════════

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { TRACKING_URL } from '../lib/config.js';

const beaconSuccess = new Rate('beacon_success');
const beaconLatency = new Trend('beacon_latency_ms');
const totalBeacons = new Counter('total_beacons_sent');
const failedBeacons = new Counter('failed_beacons');

export const options = {
    stages: [
        { duration: '1m',  target: 100 },
        { duration: '2m',  target: 1000 },
        { duration: '1m',  target: 3000 },
        { duration: '3m',  target: 3000 },
        { duration: '30s', target: 5000 },
        { duration: '2m',  target: 5000 },
        { duration: '30s', target: 10000 },
        { duration: '2m',  target: 10000 },
        { duration: '2m',  target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<2000'],             // 95% under 2s
        http_req_failed: ['rate<0.005'],                // <0.5% failure
        beacon_success: ['rate>0.995'],                 // 99.5%+ success
    },
};

export default function () {
    const sessionId = `k6-stress-${__VU}-${__ITER}-${Date.now()}`;
    const steps = ['website', 'tutorial', 'webinar', 'contract', 'congrats', 'brand-steps'];
    const step = steps[Math.floor(Math.random() * steps.length)];

    const payload = JSON.stringify({
        type: 'funnel_enter',
        page: step,
        session_id: sessionId,
        source: 'k6-beacon-stress',
    });

    const res = http.post(`${TRACKING_URL}/track`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '10s',
    });

    totalBeacons.add(1);

    const ok = check(res, {
        'status 200': (r) => r.status === 200,
        'response time < 3s': (r) => r.timings.duration < 3000,
    });

    beaconSuccess.add(ok);
    beaconLatency.add(res.timings.duration);

    if (!ok) {
        failedBeacons.add(1);
    }

    // Small sleep to simulate realistic beacon spacing
    sleep(0.1 + Math.random() * 0.4);
}
