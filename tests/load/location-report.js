/**
 * Location Report Load Test
 * 
 * Tests location signal endpoint under load:
 * - Burst of location signals
 * - Measures p95 latency, failure rate, throughput
 * 
 * Usage:
 *   k6 run tests/load/location-report.js
 *   k6 run tests/load/location-report.js --vus 50 --duration 30s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const locationLatency = new Trend('location_report_latency');

export const options = {
  scenarios: {
    // Steady state test
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 30 },   // Ramp up
        { duration: '30s', target: 30 },   // Stay at 30 users
        { duration: '10s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],  // p95 < 300ms for location
    errors: ['rate<0.1'],                // Error rate < 10%
  },
};

const BASE_URL = __ENV.SERVER_URL || 'http://localhost:3000';

// Sample coordinates
const locations = [
  { lat: 37.7749, lng: -122.4194 },  // San Francisco
  { lat: 40.7128, lng: -74.0060 },  // New York
  { lat: 51.5074, lng: -0.1278 },   // London
  { lat: 35.6762, lng: 139.6503 },  // Tokyo
  { lat: 48.8566, lng: 2.3522 },    // Paris
];

export default function locationReportLoadTest() {
  const location = locations[__VU % locations.length];
  
  const payload = JSON.stringify({
    deviceId: 'device-location-' + __VU,
    latitude: location.lat + (Math.random() - 0.5) * 0.01,
    longitude: location.lng + (Math.random() - 0.5) * 0.01,
    accuracy: Math.floor(Math.random() * 20) + 5,
    mode: 'presence',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const start = Date.now();
  const response = http.post(BASE_URL + '/api/location/report', payload, params);
  const duration = Date.now() - start;

  locationLatency.add(duration);

  const success = check(response, {
    'status is 200 or 201 or 400': function(r) { return [200, 201, 400].includes(r.status); },
    'response time OK': function(r) { return r.timings.duration < 500; },
  });

  errorRate.add(!success);

  sleep(0.05); // Small delay between iterations
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'location-load-report.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  var indent = options.indent || '';
  var output = indent + 'Location Report Load Test Summary\n';
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
