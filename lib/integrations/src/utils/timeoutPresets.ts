/** `short`/`normal` are the only fields any call site reads; `.long`/`.jwks` had zero callers and are not carried forward. */
export const TIMEOUT_PRESETS = {
  short: 5000,
  normal: 10000,
} as const;
