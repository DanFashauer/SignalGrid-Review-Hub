# Finding — the canonical dark palette and WCAG AA

**Status: RESOLVED for `deny` — DR-005, August 20, 2026.** The owner ratified
WCAG AA as the minimum contrast standard for decision-state colors and adopted
the exact tones the reverted accessibility pass had tested: **dark `#C67070`,
light `#8A3F3F`** — re-measured before applying at 5.05:1/4.55:1 (dark, on
background/card) and 6.50:1/7.33:1 (light). Web and iOS changed in the same
commit. Color remains redundant with text and icon labels, never the sole
signal.

**Canonical source moved:** DEV is retired and does not receive this change;
the decision-state palette's source of truth is now this repository —
`artifacts/signalgrid-web/src/index.css` and
`native/ios/EnterpriseShell/Services/DesignSystem.swift`, which must never
diverge.

**Still open under the ratified floor:** `allow` measures 4.32:1 on the dark
card. The owner ratified values for deny only, so allow needs an owner
proposal, queued with `brand-design`.

The original finding follows, kept as the record that motivated the decision.

---

## Why this is a finding and not a fix

`DEV/docs/BRAND_SYSTEM.md` is the canonical palette — DEV is where the company and
product were invented. Its ten hexes appear identically in three places:

| | |
|---|---|
| `DEV/docs/BRAND_SYSTEM.md` | the source |
| `artifacts/signalgrid-web/src/index.css` | 10/10 present |
| `native/ios/EnterpriseShell/Services/DesignSystem.swift` (dark) | 10/10 present |

That three-way agreement is the point. A `deny` rendered as one red in the review
console and a different red on the device is a worse defect than any contrast
ratio, because the decision colors *are* how the gate communicates its answer.

This was briefly broken on 2026-08-18: the iOS tokens were adjusted for AA in
`dd55bca` and reverted for exactly that reason. The measurements survive; the
unilateral fix did not.

## The measurements

Both surfaces the palette is used against, in dark. WCAG 2.x AA is 4.5:1 for body
text, 3:1 for large text (>=18.66px bold / >=24px regular).

| token | hex | on `#15181B` | on `#1D2226` | AA (4.5:1) |
|---|---|---|---|---|
| Primary text (Off-White 100) | `#F3F1EC` | 15.79:1 | 14.21:1 | PASS |
| Secondary text (Off-White 300) | `#D8D4CC` | 12.06:1 | 10.85:1 | PASS |
| Brand accent (Muted Teal 500) | `#4F8C87` | 4.61:1 | 4.15:1 | large text only |
| Accent hover (Muted Teal 400) | `#6FA7A1` | 6.55:1 | 5.90:1 | PASS |
| Allow | `#5E8F73` | 4.80:1 | 4.32:1 | large text only |
| Review / Step-up | `#B08B57` | 5.67:1 | 5.10:1 | PASS |
| **Deny** | **`#A15B5B`** | **3.53:1** | **3.18:1** | **large text only** |

Method: WCAG 2.x relative luminance, sRGB. Reproduce with any contrast checker.

The typography is excellent — 10:1 and better. The issue is confined to the
functional state palette, and it is worst on `deny`: **the weakest contrast in the
system sits on its most safety-critical state.**

## What is and is not at risk

**Not** at risk: color is not the sole carrier of meaning. `HostAppViewController`
renders the verdict as text (`verdict.uppercased()` — "ALLOW"/"DENY") alongside the
color, which is the WCAG 1.4.1 requirement and it is already met. A worker who
cannot distinguish the reds can still read the word.

At risk: `deny` and `allow` used as *small* text or thin iconography on either dark
surface. At 3.18:1, `deny` on a card is below even the large-text threshold's
comfort margin for a fine stroke.

## Why it was left alone

`BRAND_SYSTEM.md` is 88 lines and **adopts no accessibility standard** — no WCAG
reference, no contrast floor, no light mode. So "these values fail AA" is only a
defect if AA is a standard SignalGrid has adopted. That is not the lane's call to
make, and importing AA by fiat would be answering a brand question with a
commit. For a product sold into regulated frontline settings the answer is
plausibly yes — which is exactly why it should be decided rather than assumed.

## Options

1. **Adopt AA and re-tone the three.** Raising HSV *value* only — hue and
   saturation untouched, so they stay the same brand colors — clears 4.5:1 on both
   surfaces: `deny` `#A15B5B`→`#C67070`, `allow` `#5E8F73`→`#609376`, `primary`
   `#4F8C87`→`#53938D`. Land in `BRAND_SYSTEM.md` **first**, then web and iOS
   together, so the three-way agreement is never broken.
2. **Adopt AA but constrain usage instead.** Keep the hexes; forbid the state
   colors for small text, restricting them to large text, fills, and >=3:1
   graphical elements. Costs no brand change; needs a usage rule the linters can
   enforce.
3. **Decline AA explicitly.** Legitimate, and better than leaving it ambiguous —
   record in `BRAND_SYSTEM.md` that the palette targets aesthetic contrast, so the
   next person measuring it finds an answer instead of re-raising this.

## Also open: there is no canonical light mode

`BRAND_SYSTEM.md` defines dark only. The iOS shell now follows the device
appearance (removing a `UIUserInterfaceStyle: Light` pin that made system-colored
screens render white while branded ones rendered charcoal), so a light palette had
to exist. The values in `DesignSystem.swift` under `light:` are **derived
counterparts, not ratified brand**:

| role | derived light |
|---|---|
| background / card | `#F3F1EC` / `#FFFFFF` |
| foreground / secondary | `#15181B` / `#55606B` |
| border | `#DDD8D0` |
| primary / accent | `#3A6E6A` / `#2F5C58` |
| allow / review / deny | `#3F6B52` / `#7A5B2E` / `#8A3F3F` |

They preserve the warm-charcoal/off-white/muted-teal character inverted, hold the
background↔card relationship (card is the raised surface in both), and all clear
AA on light. They should be ratified or replaced by the brand owner, and the web
app will need the same set whenever it goes light.
