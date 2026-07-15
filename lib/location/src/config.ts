export const LOCATION_MODE = (process.env.LOCATION_MODE ?? "presence") as
  | "presence"
  | "coarse"
  | "precise";

export const LOCATION_MAX_AGE_SECONDS = (() => {
  const raw = process.env.LOCATION_MAX_AGE_SECONDS;
  const parsed = raw ? Number(raw) : 120;
  if (!Number.isFinite(parsed) || parsed < 30) return 120;
  return parsed;
})();

export const LOCATION_USE_REDIS = (process.env.LOCATION_USE_REDIS ?? "true") === "true";
