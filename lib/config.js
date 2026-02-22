// ═══════════════════════════════════════════════════════════════
// APEX LOAD TESTS — Shared Configuration
// All URLs, thresholds, and funnel step definitions in one place
// ═══════════════════════════════════════════════════════════════

export const TRACKING_URL = 'https://apex-tracking-worker-v2.apex-os.workers.dev';
export const DASHBOARD_API_URL = 'https://apex-dashboard-api.apex-os.workers.dev';
export const CANARY_URL = 'https://apex-canary-worker.apex-os.workers.dev';

export const FUNNEL_STEPS = ['website', 'tutorial', 'webinar', 'contract', 'congrats', 'brand-steps'];

// Realistic time-on-page per step (seconds)
export const TIME_ON_PAGE = {
    'website': { min: 3, max: 30 },
    'tutorial': { min: 10, max: 120 },
    'webinar': { min: 30, max: 300 },
    'contract': { min: 5, max: 60 },
    'congrats': { min: 2, max: 10 },
    'brand-steps': { min: 5, max: 60 },
};

// Realistic drop-off rates per step (% who DON'T continue)
export const DROP_OFF_RATES = {
    'website': 0.40,      // 40% leave after website
    'tutorial': 0.30,     // 30% leave after tutorial
    'webinar': 0.25,      // 25% leave after webinar
    'contract': 0.10,     // 10% leave after contract
    'congrats': 0.05,     // 5% leave after congrats
    'brand-steps': 0.0,   // end of funnel
};
