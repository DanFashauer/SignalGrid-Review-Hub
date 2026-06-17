# Microsoft Graph Local Environment Placeholder Example

This file is placeholder documentation only for a future PC-only Microsoft Graph sandbox smoke test. It is not a real `.env` file and does not contain real values.

Real values must live only outside the repository or in ignored local files such as `.signalgrid.local.env` or `.microsoft-graph-smoke.local.env`. Do not commit local `.env` files, secrets, tenant IDs, client IDs, tokens, object IDs, UPNs, emails, device serials, IMEI/ICCID values, live Graph responses, or environment-specific private values.

```dotenv
GRAPH_TENANT_ID_PLACEHOLDER=replace-only-in-local-private-env
GRAPH_CLIENT_ID_PLACEHOLDER=replace-only-in-local-private-env
GRAPH_AUTH_MODE_PLACEHOLDER=read-only-local-sandbox-auth-mode
GRAPH_SCOPE_PLACEHOLDER=least-privilege-read-only-scope
SIGNALGRID_SANITIZE_OUTPUT=true
```

## Rules

- Use sandbox tenant values only.
- Use least-privilege read-only scopes only.
- Keep `SIGNALGRID_SANITIZE_OUTPUT=true` for any local output generation.
- Do not add write scopes.
- Do not add production tenant values.
- Do not paste real tenant IDs, client IDs, secrets, tokens, object IDs, UPNs, emails, device serials, IMEI/ICCID values, or live Graph responses into documentation, issues, pull requests, logs, screenshots, or fixtures.
- Keep real values only in ignored local files or outside the repository; this placeholder document must remain safe to commit.
