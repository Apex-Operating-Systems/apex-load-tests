// ═══════════════════════════════════════════════════════════════
// APEX LOAD TEST — Smoke Test (Quick Sanity Check)
// Run this FIRST before any heavy tests. 5 virtual users, 1 minute.
// Verifies all endpoints are alive and responding correctly.
// If this fails, don't run the bigger tests — something is broken.
//
// Usage: /Users/leadfunnelagency/bin/k6 run scripts/smoke-test.js
// ═══════════════════════════════════════════════════════════════

import http from 'k6/http';
import { check, sleep } from 'k6';
import { TRACKING_URL, DASHBOARD_API_URL, CANARY_URL, FUNNEL_STEPS } from '../lib/config.js';

export const options = {
    vus: 5,
    duration: '1m',
    thresholds: {
        http_req_duration: ['p(95)<3000'],
        http_req_failed: ['rate<0.01'],
    },
};

export default function () {
    // 1. Test tracking worker health
    const healthRes = http.get(`${TRACKING_URL}/health`, { timeout: '10s' });
    check(healthRes, {
        'tracking /health → 200': (r) => r.status === 200,
        'tracking /health → has status ok': (r) => {
            try { return JSON.parse(r.body).status === 'ok'; } catch (e) { return false; }
        },
    });

    // 2. Test sending a beacon
    const sessionId = `k6-smoke-${__VU}-${__ITER}-${Date.now()}`;
    const beaconRes = http.post(`${TRACKING_URL}/track`, JSON.stringify({
        type: 'funnel_enter',
        page: 'website',
        session_id: sessionId,
        source: 'k6-smoke-test',
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '10s',
    });
    check(beaconRes, {
        'beacon POST → 200': (r) => r.status === 200,
        'beacon → success true': (r) => {
            try { return JSON.parse(r.body).success === true; } catch (e) { return false; }
        },
    });

    // 3. Test dashboard API
    const dashRes = http.get(`${DASHBOARD_API_URL}/health`, {
        headers: { 'Origin': 'https://k6-load-test.pages.dev' },
        timeout: '10s',
    });
    check(dashRes, {
        'dashboard API /health → 200': (r) => r.status === 200,
    });

    // 4. Test canary worker
    const canaryRes = http.get(`${CANARY_URL}/system-health`, { timeout: '10s' });
    check(canaryRes, {
        'canary /system-health → 200': (r) => r.status === 200,
        'canary → has probes': (r) => {
            try { return JSON.parse(r.body).probes !== undefined; } catch (e) { return false; }
        },
    });

    sleep(2);
}
