# review-demo/ — requests for review-demo-only surfaces

Everything in this folder targets routes that exist **only under the default
`review-demo` profile**. Under `SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway`
these paths answer **404**: the deferred `/v1` routes, the integrations catalog,
the monitoring routes, the simulator, and the signal radar are fenced off by the
GA allowlist (`artifacts/api-server/src/lib/profile.ts` `GA_ALLOWED_ROUTES`),
and the `sim/` + `control-plane/` routers are not mounted at all
(`artifacts/api-server/src/routes/index.ts`). A 404 here against a gateway
deployment is the fence working, not the collection drifting — see
`../negative-tests/gateway-fence-demo-route.bru` for the assertion that proves
it.

Subfolders mirror the route files: `v1/` (deferred `/v1` routes), `integrations/`,
`monitoring/`, `simulator/`, `radar/`, `sim/`, `control-plane/`.
