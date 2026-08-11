# Profile README draft — for `DanFashauer/DanFashauer`

> **What this file is.** The estate audit found no profile README —
> "the highest-leverage missing portfolio artifact." GitHub shows the README of
> a public repository named exactly `DanFashauer` at the top of the account
> page. The App cannot create repositories, so this is a ready-to-paste draft;
> the copy-paste block below is the entire proposed README. Applying it is a
> two-minute owner action (steps at the bottom). Edit freely — it is written in
> your voice, but it is a draft, not a script.

---

## The draft (copy everything between the rules)

---

# Dan Fashauer

I'm building **SignalGrid** — a trust layer for shared frontline devices: the
handhelds, carts, and kiosks passed between workers in warehouses, hospitals,
and stores.

**SignalGrid is not an MDM.** It is the trust layer that reads MDM, identity,
device, workflow, and local-authority evidence to decide whether work should
continue. The host app asks one question — *should this session proceed?* —
and gets one of four answers: allow, step up, restrict, or deny, with the
evidence attached.

A few things I hold the project to:

- **Deterministic and fail-closed.** No randomness in decision paths; an
  unknown signal raises the bar, never lowers it.
- **Proof-backed.** Every behavioral claim is pinned by an offline proof
  harness (exhaustive enumerations, not spot checks) that runs on every push.
- **Read-only by design.** Connectors supply evidence only; the source
  systems — the MDM, the IdP, the WMS — remain the systems of record.
- **Honest status.** Fixture-backed today, built lab-first on open-source MDM
  (Fleet), with Microsoft Intune/Entra as the enterprise target. No production
  deployments yet — I'm looking for design partners.

## Where the work lives

| Repository | What it is |
|---|---|
| [SignalGrid-Review-Hub](https://github.com/DanFashauer/SignalGrid-Review-Hub) | The public review surface — decision core, read-only connector families, `/v1` API, operator console, and the proof harness |
| [signalgrid-mcp](https://github.com/DanFashauer/signalgrid-mcp) | Read-only macOS posture MCP server (Python) — a signal source for the grid |
| [VaultLens](https://github.com/DanFashauer/VaultLens) | Collector intelligence app — a separate project |

📫 dan.fashauer@gmail.com

---

## How to apply it (phone or browser, ~2 minutes)

1. On github.com, tap **＋** → **New repository**.
2. Name it exactly **`DanFashauer`** (same as your username). GitHub shows a
   note: "You found a secret! … a special repository."
3. Visibility **Public**, tick **Add a README file**, create.
4. Open the new README → tap the pencil (edit) → replace its contents with the
   draft above → commit.

That's it — the account page now leads with it.
