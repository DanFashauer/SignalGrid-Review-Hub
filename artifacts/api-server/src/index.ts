import app from "./app";
import { logger } from "./lib/logger";
import { markServing } from "./lib/metrics";

// Re-exported for `test/route-stack-dump.mjs`, which boots this entry and walks
// the router stack the server actually mounted, to cross-check the source-text
// route derivations in the API suite. Export only — the boot below is unchanged.
export { app };

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  // signalgrid_up flips to 1 HERE, not at module import: the gauge answers
  // "is this process serving", and until the socket is bound it is not.
  markServing();
  logger.info({ port }, "Server listening");
});
