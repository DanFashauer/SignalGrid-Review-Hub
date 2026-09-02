/**
 * Vendor text is bounded WHERE IT IS READ, not where it is finally written.
 *
 * MEASURED, 2026-09-02: a 400 whose body was 5,000,000 bytes travelled whole into
 * `SIEMEventResponse.reason` — `HTTP 400: ${errorText}` — and from there into
 * whatever the caller logs. `webhooks/store.ts` has truncated its own two columns
 * since it was written (1000 bytes of response body, 500 of error text), which is
 * precisely why nobody noticed the other families were unbounded: the ONE path
 * with a store looked disciplined and the four without it were not.
 *
 * The two limits live HERE and `webhooks/store.ts` imports them, so the bound a
 * family applies at read time and the bound the store applies at write time are
 * one number rather than two that agree today.
 */

/** The delivery log's response-body column, and the bound every family reads to. */
export const VENDOR_BODY_TEXT_LIMIT = 1000;

/** The delivery log's error column, and the bound every error capture reads to. */
export const VENDOR_ERROR_TEXT_LIMIT = 500;

/**
 * At most `limit` characters, with the truncation STATED.
 *
 * A silently-cut error message reads as a complete one, and an operator chasing a
 * vendor error needs to know the tail is missing rather than believing the vendor
 * stopped mid-sentence.
 */
export function boundedText(text: string, limit: number = VENDOR_ERROR_TEXT_LIMIT): string {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [truncated, ${text.length} characters total]`;
}
