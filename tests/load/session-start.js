/**
 * Session Start Load Test
 * 
 * Tests session start endpoint under load:
 * - 1000 badge/session starts
 * - Measures p95 latency, failure rate, throughput
 * 
 * Usage:
 *   k6 run tests/load/session-start.js
 *   k6 run tests/load/session-start.js --vus 100 --duration 30s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const sessionLatency = new Trend('session_start_latency');

export const options = {
  scenarios: {
    // Steady state test
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },   // Ramp up
        { duration: '30s', target: 50 },   // Stay at 50 users
        { duration: '10s', target: 0 },     // Ramp down
      ],
      gracefulRampDown: '10s',
    },
    // Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 100 },   // Quick spike to 100
        { duration: '10s', target: 100 },  // Hold
        { duration: '5s', target: 0 },     // Quick drop
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],  // p95 < 500ms
    errors: ['rate<0.1'],                // Error rate < 10%
  },
};

const BASE_URL = __ENV.SERVER_URL || 'http://localhost:3000';

export default function sessionStartLoadTest() {
  var iterStr = String(__ITER);
  var vuStr = String(__VU);
  
  var payload = JSON.stringify({
    badgeUid: 'badge-load-' + vuStr + '-' + iterStr,
    deviceId: 'device-load-' + vuStr,
  });

  var params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  var start = Date.now();
  var response = http.post(BASE_URL + '/api/session/start', payload, params);
  var duration = Date.now() - start;

  sessionLatency.add(duration);

  // FAIL-CLOSED. The original predicate counted 401 and 404 as success, so a
  // server that never served this route at all (this repo's api-server serves
  // /v1/*, not /api/session/start) passed the error-rate threshold with a
  // perfect score. A load test that cannot tell "the route is missing" from
  // "the route is fast" measures nothing. Only a 200 with a session id counts.
  var success = check(response, {
    'status is 200': function(r) { return r.status === 200; },
    'has sessionId': function(r) {
      if (r.status !== 200) return false;
      try {
        var body = JSON.parse(r.body);
        return !!body.sessionId;
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(!success);

  sleep(0.1); // Small delay between iterations
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-report.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  var indent = options.indent || '';
  var output = indent + 'Session Start Load Test Summary\n';
  output += indent + '=============================\n\n';
  
  var httpStats = data.metrics.http_req_duration;
  if (httpStats) {
    output += indent + 'Response Time (p95): ' + httpStats['p(95)']?.toFixed(2) + 'ms\n';
    output += indent + 'Avg Response Time: ' + httpStats.avg?.toFixed(2) + 'ms\n';
  }
  
  var errorStats = data.metrics.errors;
  if (errorStats) {
    output += indent + 'Error Rate: ' + (errorStats.rate * 100).toFixed(2) + '%\n';
  }
  
  return output;
}
