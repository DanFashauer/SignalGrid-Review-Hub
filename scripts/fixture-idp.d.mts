export const KID: string;
export const MINT_KINDS: string[];
export interface FixtureIdp {
  jwks: { keys: Array<Record<string, unknown>> };
  discovery: { issuer: string; jwks_uri: string; id_token_signing_alg_values_supported: string[] };
  mint(kind?: string): string;
  handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void;
}
export function createFixtureIdp(options: {
  issuer: string;
  audience?: string;
  idpTenant?: string;
  idpRole?: string;
  jwksKey?: "signing" | "other";
  nowSec?: () => number;
}): FixtureIdp;
