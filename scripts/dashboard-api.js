// ═══════════════════════════════════════════════════════════════
// APEX LOAD TEST — Dashboard API Stress Test
// Tests the dashboard API under load — this is what the CEO
// Dashboard hits every 30 seconds. At scale, multiple dashboards
// could be open simultaneously plus the canary worker polling.
// ═══════════════════════════════════════════════════════════════

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { DASHBOARD_API_URL } from '../lib/config.js';

const apiSuccess = new Rate('api_success');
const apiLatency = new Trend('api_latency_ms');

export const options = {
    stages: [
        { duration: '1m',  target: 10 },
        { duration: '2m',  target: 50 },
        { duration: '2m',  target: 100 },
        { duration: '3m',  target: 100 },
        { duration: '1m',  target: 200 },
        { duration: '2m',  target: 200 },
        { duration: '2m',  target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<3000'],
        http_req_failed: ['rate<0.01'],
        api_success: ['rate>0.99'],
    },
};

export default function () {
    // Hit the main endpoints the dashboard uses
    const endpoints = [
        '/funnel',
        '/stats',
        '/health',
    ];

    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const res = http.get(`${DASHBOARD_API_URL}${endpoint}`, {
        headers: {
            'Origin': 'https://k6-load-test.pages.dev',
        },
        timeout: '10s',
    });

    const ok = check(res, {
        'status 200': (r) => r.status === 200,
        'valid JSON': (r) => {
            try { JSON.parse(r.body); return true; } catch (e) { return false; }
        },
        'response < 3s': (r) => r.timings.duration < 3000,
    });

    apiSuccess.add(ok);
    apiLatency.add(res.timings.duration);

    // Dashboard polls every 30s — simulate faster for stress
    sleep(1 + Math.random() * 2);
}
