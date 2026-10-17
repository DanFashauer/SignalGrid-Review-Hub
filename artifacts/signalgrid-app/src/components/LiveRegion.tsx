// Visually hidden live regions (WCAG 4.1.3, plan row 76). Views that poll render
// one: `message` is a short polite summary of what the view shows, and `alert`
// is an assertive channel (`role="alert"` alone: adding aria-live="assertive" makes
// VoiceOver on iOS speak it twice) for a read that FAILED or a state that is broken — an
// unreachable feed must not be silent. Both regions stay mounted so a change of
// text is what gets announced; a refetch that returns the same data is silent.
// scripts/check-web-a11y-basics.mjs fails a polling view that renders none.
export function LiveRegion({ message, alert = "" }: { message: string; alert?: string }) {
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </div>
      <div role="alert" aria-atomic="true" className="sr-only">
        {alert}
      </div>
    </>
  );
}
