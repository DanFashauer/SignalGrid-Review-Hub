# docs/research — strategy, positioning and outreach material

Moved out of the top-level docs set on 2026-08-10 (plan §11.4): sales, social,
founder-strategy, competitive and stale-readiness documents. When this README was
written (2026-08-10) no gate, proof, script or workflow referenced any of them;
that stopped being true on 2026-09-02, when `check-mcp-ecosystem-map.mjs` began
reading `MCP_ECOSYSTEM_SIGNAL_SOURCES.md` as a hard gate, and several more files here
are named by scripts or workflows today — derive the current set with
`grep -rl docs/research/ scripts/ .github/workflows/` rather than trusting a count
typed here (the count this sentence once carried was wrong). They also remain inside every recursive
doc guard (figures, proof counts, cited paths, sync manifest) — relocated, not un-checked.
The top-level docs/ set is the operating product documentation.
