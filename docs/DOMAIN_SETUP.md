# Domain setup — signalgrid.app on GitHub Pages

How to point **signalgrid.app** at the SignalGrid marketing site
(`artifacts/signalgrid-web`) hosted on GitHub Pages. The `Deploy site to Pages`
workflow (`.github/workflows/pages.yml`) builds the site; this is the one-time
DNS + settings wiring around it. Everything served is public-safe static
content — no server, no data.

## What deploys where

| Path | Content |
|---|---|
| `https://signalgrid.app/` | Marketing site (signalgrid-web), incl. `/hardware`, `/pricing`, `/federal` via SPA routing |
| `https://signalgrid.app/console.html` | Trusted Room Entry on-device console demo |
| `https://signalgrid.app/battlecard.html` | Competitive battlecard |

`site/CNAME` pins the custom domain; a `404.html` fallback lets deep links into
the single-page app resolve instead of 404-ing.

## One-time setup (owner)

### 1. Turn on Pages
Repo **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

### 2. Add the DNS records in Namecheap
**Domain List → Manage → Advanced DNS.** Remove the parking-page record first,
then add:

**Apex (`signalgrid.app`) — four A records** (Type `A Record`, Host `@`):

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

**Apex IPv6 — four AAAA records** (Type `AAAA Record`, Host `@`) — optional but
recommended:

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

**`www` subdomain — one CNAME** (Type `CNAME Record`, Host `www`, Value):

```
danfashauer.github.io.
```

> These four A record IPs are GitHub's published Pages addresses. If GitHub
> changes them, take the current values from GitHub's "Managing a custom domain
> for your GitHub Pages site" documentation.

### 3. Deploy
**Actions → "Deploy site to Pages" → Run workflow.** (It is manual-only, so it
never fires on its own.)

### 4. Bind the domain + force HTTPS
**Settings → Pages → Custom domain →** enter `signalgrid.app`, Save. Once the DNS
check passes, tick **Enforce HTTPS**. `.app` is HTTPS-only (it is on the browser
HSTS preload list), so the certificate must finish provisioning before the site
loads — this can take a few minutes to an hour after the DNS records propagate.

## Also worth doing (owner, unrelated to hosting)

- **Enable Domain Privacy / WhoisGuard** in Namecheap so the registrant contact
  details are not exposed in the public WHOIS database.

## Go-live checklist

- [ ] Pages source set to "GitHub Actions".
- [ ] Four `A` records + `www` `CNAME` added; parking-page record removed.
- [ ] `Deploy site to Pages` run once, green.
- [ ] Custom domain `signalgrid.app` set in Settings → Pages (DNS check passes).
- [ ] **Enforce HTTPS** ticked and the certificate provisioned.
- [ ] `https://signalgrid.app/`, `/console.html`, and a deep link like
      `/pricing` all load over HTTPS.
- [ ] Domain Privacy enabled.

## Redeploying

Any time the marketing site or demos change, re-run **Actions → "Deploy site to
Pages"**. The `CNAME` and HTTPS settings persist across deploys.
