/** STRICT `=== "GET"` check, no `.toUpperCase()` — fail-closed doctrine treats a
 *  case-folded compare as tolerating spelling drift, not as safety. A factory
 *  because each connector must throw its OWN error class/code/message, and
 *  proofs assert `instanceof` on that class. */
export function createReadOnlyGuard(makeError: (method: string) => Error): (method: string) => void {
  return (method: string): void => {
    if (method !== "GET") {
      throw makeError(method);
    }
  };
}
