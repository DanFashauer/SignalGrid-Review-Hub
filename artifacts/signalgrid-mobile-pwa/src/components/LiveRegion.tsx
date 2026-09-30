// A polite, visually hidden status region (WCAG 4.1.3, plan row 76). Views that
// poll render one with a short summary of what they show; a screen reader
// announces the summary only when its text changes, so a refetch that returns
// the same data is silent and a new deny landing in the list is not.
// scripts/check-web-a11y-basics.mjs fails a polling view that renders none.
export function LiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
