/** Entry point: `signalgrid <command>`. Everything testable lives in cli.ts. */
import { main } from "./cli.js";

const r = await main(process.argv.slice(2), process.env);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.exit;
