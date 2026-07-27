# Full-stack web E2E (Playwright)

Real-browser end-to-end coverage for the web layer: a headless Chromium loads each
built console, and we assert the **live-data** consoles actually reach the running
`api-server` and render its responses (browser → console JS → api-server → DOM),
while the **static** consoles render without errors.

| Console | Port | Kind | Asserted |
| --- | --- | --- | --- |
| `signalgrid-app` (user) | 5180 | live | ≥1 successful api call, no failures, renders |
| `signalgrid-desktop` | 5182 | live | ≥1 successful api call, no failures, renders |
| `signalgrid-mobile-pwa` | 5181 | live | ≥1 successful api call, no failures, renders |
| `signalgrid-review` (admin) | 5173 | static | renders, no page errors |
| `signalgrid-web` (website) | 5183 | static | renders, no page errors |

## Run

```bash
cd e2e
./run.sh          # builds consoles + api-server, serves them, runs Playwright, tears down
```

`run.sh` bakes `VITE_API_BASE_URL=http://127.0.0.1:5174` into the live consoles and
starts the api-server with those origins in `CORS_ALLOWED_ORIGINS`.

## Notes

- **Native binaries:** the repo's `pnpm-workspace.yaml` strips native binaries to
  linux-x64. `run.sh` adds back the host's variant (darwin-arm64 / linux-arm64) for
  the vite build, then reverts the manifest churn — identical to `validate-sim-macos.sh`.
  On a linux-x64 CI runner no swap is needed.
- **Playwright browser:** `npx playwright install chromium` downloads the browser
  once (not committed). `node_modules/`, `test-results/`, and `screens/` are gitignored.
- The harness is intentionally **outside** the pnpm workspace (its own `package.json`)
  so Playwright doesn't entangle the workspace lockfile/overrides.
