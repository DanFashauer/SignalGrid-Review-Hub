# HTTP status codes, MIME, ports, markdown — what the API and the doc gates actually do

The `/v1` API answers in one flat envelope, `{requestId, error, message}`, and the host-app
SDKs read ANY non-2xx from `POST /v1/authorize` as deny — so a status code here is a
decision, not a convention. Docs under `docs/` are read by three different parsers
(`check-doc-orphans`, `check-proof-figures`, `docs-sanity`) that agree with GitHub's
renderer only where the markdown is plain. Verified 2026-09-04.

## Status codes

1. **SAYS** 403 Forbidden — "access is forbidden to the requested page" (use it whenever the
   caller may not see the thing).
   **BREAKS** `lib/profile.ts` — "WHY 404 AND NOT 403": a route that exists and refuses still
   answers "does this deployment have a control plane?" A cross-tenant read must be
   indistinguishable from a nonexistent id.
   **DO** 404 in the flat envelope (`error: 'not_found'`) for BOTH "no such id" and "exists
   but not your tenant / fenced by profile". 403 is reserved for an AUTHENTICATED principal
   whose proof failed — a replayed, expired or mismatched enrollment or step-up assertion.
2. **SAYS** 401 Unauthorized — "the requested page needs a username and a password".
   **BREAKS** `middlewares/context.ts`: exactly ONE credential type is accepted, chosen by
   SERVER configuration, never by the caller — there is deliberately no second path and no
   default tenant.
   **DO** on a 401 from a probe, check the deployment profile and the OIDC env. Never add
   Basic auth, a `WWW-Authenticate` prompt, a second credential path, or a demo key to make
   the request succeed.
3. **SAYS** 404 Not Found — a harmless client error.
   **BREAKS** the `GA_ALLOWED_ROUTES` comment in `lib/profile.ts`: the Assist wire MUST sit on
   the fence — a gateway that 404s it denies every worker in the building.
   **DO** treat a 404 on `POST /v1/authorize`, `/healthz` or `/readyz` in ANY test or proof
   output as a deny/outage regression. When classifying a route `launch`, add it to
   `GA_ALLOWED_ROUTES` and run the profile gate.
4. The repo's mapping, from source: **400** `bad_request` — malformed JSON, unsupported
   charset or encoding; **401** — a missing, unknown or unverifiable bearer; **403** — see 1;
   **404** — see 1 and 3, plus unknown `/api` paths hit a JSON catch-all mounted LAST
   (`routes/index.ts`) so a typo never falls through to an HTML page; **409** — "No enrolled
   step-up credential for this identity. Enroll first." (`v1.ts`), emitted only AFTER
   `authorize(principal, …)`; **413** `payload_too_large` — body over `express.json({ limit:
   "64kb" })`; **429** — the SAME flat envelope, and `requestContext` runs BEFORE the limiter
   so a 429 still carries `x-request-id` and the security headers.

## MIME and ports

5. **SAYS** "5432 PostgreSQL", "6379 Redis" as the ports to use; "2375 Docker — Docker without
   TLS".
   **BREAKS** `scripts/docker-verify.mjs` publishes Postgres on **5433** "so a developer's local
   5432 is never disturbed" and Redis on **6380** for the same reason; the harness uses 6381;
   the migrate overlay uses `127.0.0.1:55432`. 2375 is an unauthenticated engine socket.
   **DO** a new harness store gets an unused OFFSET port bound to `127.0.0.1`, probed on the
   host side via `/dev/tcp` BEFORE its URL is exported. Never publish 5432/6379 on the host,
   never expose 2375. Repo port map: api **8080** (`Dockerfile.api` `EXPOSE 8080`, every
   compose file); web **3000**; verify Postgres 5433; Redis 6380 / 6381; migrate 55432.
6. Request bodies must carry `content-type: application/json` — `express.json` parses only
   that type. `curl -d` WITHOUT the header sends `application/x-www-form-urlencoded`, the body
   parses as empty, and the request is a 400, not the test you meant.
7. Response types the repo depends on: `application/json` for everything under `/api`;
   `text/plain; version=0.0.4` on `/metrics` (Prometheus exposition). And a trap from the
   MIME sheet: `.ts` is registered as `video/mp2t` (MPEG transport stream) — a static server
   handed a TypeScript source serves it as video. `.mjs` → `text/javascript`; `.md` →
   `text/markdown`. `docker/nginx-web.conf` serves the vite build, never sources.

## Markdown that the doc gates read

8. **SAYS** "a markdown table generator: tableconvert.com" (and the MIME sheet's 23
   `tableconvert.com/…?data=` conversion links).
   **BREAKS** CLAUDE.md "Ask before … anything that sends data to an external service"; and
   tableconvert's output backslash-escapes `.`, `-` and `(` everywhere, which breaks every
   backticked path and therefore `scripts/check-cited-paths.mjs`.
   **DO** hand-write GFM tables or a local node one-liner. Never escape `.`/`-` inside a
   backticked path. After pasting ANY converted table, run `node scripts/check-cited-paths.mjs`
   and read the count.
9. **SAYS** Setext headers (`Header 2` over `--------`) and "horizontal line — hyphens `---`".
   **BREAKS** `scripts/check-proof-figures.mjs` bounds sections on `/^#{2,3} /` ONLY, so a
   setext heading never starts a section and the figures under it are attributed to the
   section above; a `---` directly under a text line IS a setext heading to GitHub.
   **DO** ATX `##` / `###` always — they are the unit the figure guard, `check-doc-orphans` and
   `check-launch-claims` reason about. Put a blank line before any `---` so it stays a rule.
10. **SAYS** list markers `_ Item` / `+ Item`; nested ordered `a. Item 3a`.
    **BREAKS** `_` is not a CommonMark list marker and `a.` is not an ordered marker — both
    render as literal paragraph text on GitHub and the Pages site. The sheet is wrong here.
    **DO** `-` for bullets, `1.` for ordered items, three-space indentation to nest. Preview on
    GitHub rather than trusting the sheet.
11. Three parsers, three scopes: `check-doc-orphans` counts only `[text](PATH)` and `[id]:
    PATH` links and STRIPS fenced code and HTML comments before counting — a link that lives
    only inside a fence does not rescue an orphan; `check-proof-figures` scopes figures by
    `^#{2,3} ` headings, so a figure in a fenced `bash` block's trailing comment still belongs
    to the section; `docs-sanity` lowercases the whole file and phrase-matches the DENYLIST —
    an HTML comment does NOT hide a claim from it, and neither does a code fence.
