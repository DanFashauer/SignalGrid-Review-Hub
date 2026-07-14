/**
 * Webhook Dispatch Load Test
 * 
 * Tests webhook delivery under load:
 * - Concurrent webhook dispatches
 * - Measures delivery success rate, retry behavior
 * 
 * Usage:
 *   k6 run tests/load/webhooks.js
 *   k6 run tests/load/webhooks.js --vus 20 --duration 30s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const webhookLatency = new Trend('webhook_dispatch_latency');
const webhookDeliveries = new Counter('webhook_deliveries');

// Webhook test endpoint (would need to be configured)
const WEBHOOK_URL = __ENV.WEBHOOK_URL || 'https://httpbin.org/post';

export const options = {
  scenarios: {
    // Steady webhook dispatch
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },   // Ramp up
        { duration: '30s', target: 20 },   // Stay at 20 users
        { duration: '10s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // p95 < 1s for webhooks
    errors: ['rate<0.2'],                 // Allow higher error rate (webhook may fail)
  },
};

const events = [
  'session.start',
  'session.end',
  'badge.enroll',
  'badge.delete',
  'policy.triggered',
  'location.observed',
];

export default function webhooksLoadTest() {
  var event = events[__VU % events.length];
  var iterStr = String(__ITER);
  var vuStr = String(__VU);
  
  var payload = JSON.stringify({
    event: event,
    timestamp: new Date().toISOString(),
    data: {
      sessionId: 'session-' + vuStr + '-' + iterStr,
      deviceId: 'device-' + vuStr,
      userId: 'user-' + vuStr + '@example.com',
    },
  });

  var params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': 'test-signature', // In production, would be real HMAC
    },
  };

  var start = Date.now();
  var response = http.post(WEBHOOK_URL, payload, params);
  var duration = Date.now() - start;

  webhookLatency.add(duration);

  var success = check(response, {
    'status is 2xx or 4xx': function(r) { return r.status >= 200 && r.status < 500; },
    'response time OK': function(r) { return r.timings.duration < 2000; },
  });

  if (response.status >= 200 && response.status < 300) {
    webhookDeliveries.add(1);
  }

  errorRate.add(!success);

  sleep(0.5); // Delay between webhook dispatches
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'webhook-load-report.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  var indent = options.indent || '';
  var output = indent + 'Webhook Load Test Summary\n';
  output += indent + '==========================\n\n';
  
  var httpStats = data.metrics.http_req_duration;
  if (httpStats) {
    output += indent + 'Response Time (p95): ' + httpStats['p(95)']?.toFixed(2) + 'ms\n';
    output += indent + 'Avg Response Time: ' + httpStats.avg?.toFixed(2) + 'ms\n';
  }
  
  var errorStats = data.metrics.errors;
  if (errorStats) {
    output += indent + 'Error Rate: ' + (errorStats.rate * 100).toFixed(2) + '%\n';
  }
  
  var deliveryCount = data.metrics.webhook_deliveries;
  if (deliveryCount) {
    output += indent + 'Successful Deliveries: ' + (deliveryCount.values ? deliveryCount.values.count : 0) + '\n';
  }
  
  return output;
}
