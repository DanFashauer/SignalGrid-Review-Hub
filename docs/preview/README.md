# SignalGrid preview / pre-announcement assets (public-safe)

Public-safe, self-contained visual assets for a **pre-launch** sneak peek. They
frame SignalGrid as pre-announcement / public-safe alpha and category-building —
no production, compliance, partnership, or replacement claims. They show the
product's signature moment: a live trust decision (`ALLOW`) traced to its
reason code, policy version, and tamper-evident audit chain.

| Asset | Size | Use |
| ----- | ---- | --- |
| [`signalgrid-teaser.html`](signalgrid-teaser.html) | full page | Hero teaser page (dark, animated signal-grid) |
| [`assets/signalgrid-teaser.png`](assets/signalgrid-teaser.png) | 3200×2000 (1600×1000 CSS px at 2×) | Rendered teaser image |
| [`assets/signalgrid-og.html`](assets/signalgrid-og.html) | 1200×630 | Social / OG card source |
| [`assets/signalgrid-og.png`](assets/signalgrid-og.png) | 2400×1260 (1200×630 CSS px at 2×) | Social / OG card image (link previews, posts) |

## The PNGs are rendered, not drawn

Each PNG is produced from the HTML source beside it. Do not hand-edit a PNG, and
never edit a source without re-rendering:

```bash
node scripts/render-preview-assets.mjs     # re-render every declared source
node scripts/check-rendered-assets.mjs     # gate: is each PNG a render of the CURRENT source?
```

Each source declares its own render contract in its markup
(`<!-- render-viewport: WxH -->` and `<!-- render-output: path.png -->`), so the
render set is derived from the pages themselves rather than listed anywhere.
`assets/renders.json` records, per PNG, the sha256 of its source at render time;
the gate fails when a source moves and its PNG does not. That gate exists because
it already happened: commit ab72355 (2026-09-01) deleted a retired category-label
eyebrow from both HTML sources and left both PNGs untouched, so the social card
kept publishing a superseded label for five days.

Rendering is deterministic (deviceScaleFactor 2, `fullPage: false`,
`prefers-reduced-motion: reduce` — which is what stops the teaser's animated,
`Math.random()`-seeded canvas from varying between runs). Sizes above are the
rendered pixel sizes at deviceScaleFactor 2 — the same raster the files shipped at
before the renderer existed, so a re-render changes content, never resolution.

The pages are self-contained (system fonts, inline styles, Canvas graphic) and
use synthetic data only. Keep messaging within
[`docs/PUBLIC_MESSAGING_GUARDRAILS.md`](../PUBLIC_MESSAGING_GUARDRAILS.md).
