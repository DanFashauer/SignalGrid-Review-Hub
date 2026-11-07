// Module resolve hook: the bare specifier `pg` resolves to the fake driver.
// Every other specifier resolves as normal.
const FAKE_PG = new URL("./fake-pg.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "pg") return { url: FAKE_PG, shortCircuit: true, format: "module" };
  return nextResolve(specifier, context);
}
