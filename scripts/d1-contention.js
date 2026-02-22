// ═══════════════════════════════════════════════════════════════
// APEX LOAD TEST — D1 Concurrent Write Contention
// THE CRITICAL TEST: This finds the breaking point for D1 (SQLite)
// All VUs write to the SAME funnel step to maximize write contention
// This simulates the worst case: thousands of users hitting contract
// page simultaneously (e.g., after a viral moment or email blast)
// ═══════════════════════════════════════════════════════════════

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { TRACKING_URL } from '../lib/config.js';

const writeSuccess = new Rate('d1_write_success');
const writeFails = new Counter('d1_write_failures');
const writeLatency = new Trend('d1_write_latency_ms');
const totalWrites = new Counter('total_write_attempts');

export const options = {
    stages: [
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 250 },
        { duration: '1m',  target: 500 },
        { duration: '2m',  target: 500 },
        { duration: '30s', target: 1000 },
        { duration: '2m',  target: 1000 },
        { duration: '30s', target: 2000 },
        { duration: '2m',  target: 2000 },
        { duration: '2m',  target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.02'],                // <2% failure (we expect SOME D1 fails)
        d1_write_success: ['rate>0.98'],               // 98%+ writes succeed
        d1_write_failures: ['count<50'],               // Less than 50 total failures
    },
};

export default function () {
    const sessionId = `k6-d1-${__VU}-${__ITER}-${Date.now()}`;

    // ALL virtual users hit the SAME step to maximize D1 contention
    const payload = JSON.stringify({
        type: 'funnel_enter',
        page: 'contract',
        session_id: sessionId,
        source: 'k6-d1-contention',
    });

    const res = http.post(`${TRACKING_URL}/track`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '15s',
    });

    totalWrites.add(1);
    writeLatency.add(res.timings.duration);

    const ok = check(res, {
        'write accepted (200)': (r) => r.status === 200,
        'not rate limited (429)': (r) => r.status !== 429,
        'not server error (5xx)': (r) => r.status < 500,
    });

    writeSuccess.add(ok);
    if (!ok) {
        writeFails.add(1);
        // Log failure details for investigation
        console.log(`WRITE FAIL: VU=${__VU} status=${res.status} body=${res.body}`);
    }

    // Minimal sleep — we WANT maximum contention
    sleep(0.05 + Math.random() * 0.1);
}
