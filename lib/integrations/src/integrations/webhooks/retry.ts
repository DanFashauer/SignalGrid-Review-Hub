/**
 * Webhook Retry Logic
 * 
 * Exponential backoff with jitter for reliable delivery.
 */

import crypto from 'crypto';

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Jitter factor (0-1) */
  jitterFactor: number;
}

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 6,
  baseDelayMs: 1000, // 1s, 2s, 4s, 8s, 16s, 32s
  maxDelayMs: 60000, // 1 minute max
  jitterFactor: 0.2, // ±20% jitter
};

/**
 * Calculate delay for a given attempt using exponential backoff with jitter
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential: baseDelay * 2^(attempt-1)
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  
  // Add jitter
  const jitter = cappedDelay * config.jitterFactor;
  const jitterAmount = (Math.random() * 2 - 1) * jitter;
  
  return Math.round(cappedDelay + jitterAmount);
}

/**
 * Get the next retry timestamp
 */
export function getNextRetryAt(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Date {
  const delay = calculateBackoff(attempt, config);
  return new Date(Date.now() + delay);
}

/**
 * Check if an attempt should be retried based on response code
 */
export function isRetryableStatus(statusCode: number): boolean {
  // Retry on network errors, timeouts, and 5xx errors
  // Also retry on 429 (rate limited)
  return (
    statusCode === 408 || // Request Timeout
    statusCode === 429 || // Too Many Requests
    statusCode === 500 || // Internal Server Error
    statusCode === 502 || // Bad Gateway
    statusCode === 503 || // Service Unavailable
    statusCode === 504   // Gateway Timeout
  );
}

/**
 * Check if max retries have been reached
 */
export function hasReachedMaxAttempts(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  return attempt >= config.maxAttempts;
}

/**
 * Get retry schedule as array of delays
 */
export function getRetrySchedule(
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number[] {
  const schedule: number[] = [];
  for (let i = 1; i <= config.maxAttempts; i++) {
    schedule.push(calculateBackoff(i, config));
  }
  return schedule;
}
