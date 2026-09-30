import { useSyncExternalStore } from "react";

// recharts 2.x animates in JavaScript and never reads prefers-reduced-motion,
// so the stylesheet's reduced-motion block cannot reach it; a chart that
// re-animates on every poll needs `isAnimationActive={!reduceMotion}` from here.
// Where the media query cannot be read, motion is treated as reduced: an
// unknown preference gets the calmer answer. Plan row 76; held by
// scripts/check-web-a11y-basics.mjs.
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
