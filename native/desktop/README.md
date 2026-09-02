# SignalGrid Assist — desktop (Windows / Linux)

A reference host-app shell. It shows what a desktop application does with an
Assist decision — `allow`, `step_up`, `restrict` or `deny` — and what it may do
next. SignalGrid is invisible to the worker; this window stands in for the host
app they actually use.

## What it does, and does not

- **It decides nothing.** Every rule lives in `core/` (`signalgrid-assist-core`):
  the four-outcome vocabulary, fail-closed parsing of a `/v1` response, and
  endpoint validation. `cargo test` there runs with no display server and is the
  gate that matters. `app/` is a Tauri 2 window that renders what the core returns.
- **It contacts no gate.** The decision on screen is a **fixture**, labelled as
  one in the window, shaped like the served `/api/v1/authorize` response
  (`{assist, decisionId, reasons}` — the spec declares no `obligations` field, so
  a `step_up` renders as "step up required; the gate did not state an
  obligation"). There is no HTTP client in either crate.
- **`SIGNALGRID_GATE_URL` is validated and displayed, never used.** Set it and
  the Gate panel shows the vetted URL with the words "validated only; this build
  never contacts it"; leave it unset and the panel says so. The core refuses
  plaintext `http://` to anything but loopback (`localhost`, `127.0.0.1`, `::1`)
  — the Android emulator alias `10.0.2.2` is a routable address on a desktop and
  is refused. The base URL must be the **`/api` mount** (`https://host/api`); the
  client appends `/v1/authorize` to it.

## Prerequisites

| Platform | Needed |
| --- | --- |
| Any | Rust stable (crate `rust-version` 1.77 for `app/`, 1.74 for `core/`), Node 22 for the icon check |
| Linux | `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf` (what `.github/workflows/desktop.yml` installs); WebKitGTK must be present at run time |
| Windows | the WebView2 runtime, which ships with Windows 10/11 and the CI image |
| macOS | nothing beyond Xcode command-line tools; not a CI target — see below |

`core/` builds on a machine with none of the Linux packages; only `app/` needs a
webview.

## Build and test

```bash
cargo test --manifest-path native/desktop/core/Cargo.toml     # the trust rules
cargo test --manifest-path native/desktop/app/Cargo.toml      # the shell's own tests
cargo build --release --manifest-path native/desktop/app/Cargo.toml
./native/desktop/app/target/release/signalgrid-assist-desktop  # opens the window
```

`app/` tests include one that reads `tauri.conf.json` and asserts
`app.withGlobalTauri` is `true`. The UI reaches the core only through
`window.__TAURI__.core.invoke("decision")`, and that global does not exist unless
the key is set (Tauri's default is `false`) — without it every launch showed
"Could not read the decision from the core" over empty panels, and CI stayed
green because CI never opens a window.

## What CI proves, exactly

`.github/workflows/desktop.yml` runs `cargo fmt --check`, `cargo clippy -D
warnings`, `cargo test` and `cargo build --release` on `ubuntu-latest` and
`windows-latest`, and uploads the bare executable. That is the whole claim:

- an **unsigned executable**, not an installer — `bundle.active` is `false` in
  `tauri.conf.json` because no job runs `tauri build`, and a config claiming
  installers nothing produces is the same defect as a doc claiming one;
- **no window is ever opened in CI.** Whether the shell renders is checked by a
  person running it, or by the Mac lane's `desktop-window-smoke` operation
  (`scripts/mac/desktop-window-smoke.sh`), which builds, launches, captures a
  screenshot, and passes only if the process survives ten seconds AND the PNG
  exists — the banner defect leaves the process alive, so "alive" alone would
  pass on it. Reading the screenshot for the error banner is a visual check,
  stated as one. If the core cannot be read, the UI renders a `deny` badge and
  "The host app must NOT proceed on this alone." before the error note;
- no code signing, no notarisation, no auto-update, no macOS build.

`artifacts/signalgrid-desktop` is a separate Vite web app — the operator console
— and is not this.
