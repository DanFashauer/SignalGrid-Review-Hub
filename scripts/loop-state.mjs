// The loop check — does reality match what LOOP.md says?
//
//   pnpm run loop:state
//
// WHY THIS EXISTS
// ---------------
// Work on this project happens in at least three places: chat (strategy and
// doctrine), Claude Code (patches and gates), and a browser (the public Review
// Hub). Nothing watches the seams between them.
//
// On 2026-08-27 that cost a week: Phase 0 was applied and verified green
// locally, pushed — and never arrived on the Review Hub. The public README kept
// showing the exact phrase Phase 0 existed to retire, and nobody noticed,
// because every individual tool reported success.
//
// This script is the thing that notices. It reads the world, not the notes, and
// reports where they disagree. It is deliberately read-only: it changes nothing,
// so it is safe to run half-awake on a Sunday.

import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmSync, mkdirSync, statSync, symlinkSync, utimesSync, realpathSync, openSync, closeSync, fstatSync, renameSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve, isAbsolute, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HUB = "https://github.com/DanFashauer/SignalGrid-Review-Hub.git";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";
const rows = [];
// `gated` is whether a `fail` in this row moves the EXIT CODE. Every seam row
// is gated. The discovery rows are reported — as a warning, never red/fatal
// since DR-033 (past Customer Discovery: discovery is an input, not the gate) —
// but do not set the exit code, because the Stop hook (.claude/hooks/verify-done.sh)
// runs this script as its gate and a hook that blocks every session over a number
// no session can change teaches bypass. Until 2026-09-05 the script exited 0
// on EVERY outcome, so the hook's gate arm could never fire at all.
const add = (state, what, detail, gated = true) => rows.push({ state, what, detail, gated });

// Read a file that may not be there, in ONE operation. `existsSync(p) ? readFileSync(p) : ...` checks and then reads, and the file can change between the two
// (CodeQL js/file-system-race); here the read itself answers. null means ABSENT, and only ENOENT (no such file) and ENOTDIR (a parent is a file) say that: every other
// failure (EISDIR, EACCES, EIO, ...) is thrown, so an unreadable file is never taken for a missing one (fail closed). Same outcome as before for both: a missing file read
// as absent, a present-but-unreadable file crashed the check.
function readIfPresent(path, encoding = "utf8") {
  try {
    return readFileSync(path, encoding);
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return null;
    throw e;
  }
}

// THE ONE PLACE this file starts a git that reads objects (the self-test scans the source for any other: R7-spawns).
// Until round 7 the guards were a flag on SOME commands: `--no-replace-objects` was prepended by gitIn only, so gitRaw (the
// diffs landedByPatchId and the path list read), gitFeed and the apply / read-tree / write-tree spawns of reappliesExactly ran
// with refs/replace/* ON, and `git replace <tip> <a mainline squash>` made a branch with REAL unpushed work read "exact hunks
// found in a mainline squash" (round-6 refute E1, E2, shallow too). Three things are set here, for every command, once:
//   GIT_NO_REPLACE_OBJECTS=1 in the ENVIRONMENT, not a flag on the command: a helper git starts itself (apply, read-tree,
//     write-tree, patch-id) inherits it, so no path reads through a replace ref. It does NOT cover a legacy .git/info/grafts
//     file, which git still honours with replace objects off; graftsBlock below is the guard for that, and EVERY exemption
//     that rests on ancestry or on mainline's history (the alias, the byte check, the hunk check) consults it.
//   core.commitGraph=false: objects/info/commit-graph is a cache git trusts WITHOUT checking it against the objects, and a
//     forged one makes any commit the parent of any other (round-6 refute A10: a Hub-listed commit "held" a tip it does not).
//     Every ancestry answer here is computed from the commit objects themselves.
//   GIT_OPTIONAL_LOCKS=0: a read-only check must not write. `git status` otherwise refreshes (and locks) the index; the live
//     run from a session took the index lock.
//   And what git would otherwise read from the CALLER's environment is dropped (round-7 refute; extended in rounds 9, 11, 12, 18, 22, 23 and 24, each of which found a name the earlier lists missed. The lists below are an
//   audit of the GIT_* names in the git binary (git 2.43) that select a file, a directory or a program, not a promise that a later git adds none; the differential self-test cases are what keep them honest):
//     every GIT_TEST_* variable (GIT_TEST_COMMIT_GRAPH=1 forces the commit-graph back on over core.commitGraph=false, so a forged graph held a tip again);
//     GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES (they point the object reads at a store this check did not choose);
//     GIT_DIR, GIT_COMMON_DIR, GIT_WORK_TREE, GIT_NAMESPACE (they point every read at a repository, a worktree or a ref namespace this
//     check did not choose: a GIT_DIR at a decoy hid every branch, and the spawn's `-C <repo>` would not have helped, since GIT_DIR beats discovery);
//     GIT_PROXY_COMMAND and GIT_SSL_NO_VERIFY (a transport override and a switch that turns TLS verification off; the second is also a gated
//     finding in hubTransport, since it says the session's own fetches are unverified).
//   KEPT, on purpose: GIT_SSL_CAINFO and GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n. The sandbox this runs in reaches github.com through an
//     environment-provided proxy with its own CA bundle, and its URL rewrites arrive as GIT_CONFIG_* entries; dropping them breaks the real listing,
//     and a check that fails on every legitimate transport gets switched off. They are TRUSTED, not verified, and hubTransport says so in its row.
//   Every command is also pinned with `-C <repo>` (resolved to an absolute path, so the spawn's cwd and -C cannot compound).
// The replace guard on the apply / read-tree / write-tree spawns is load-bearing too, in the fail-closed direction: a refs/replace entry on
// the squash parent's blob makes git apply the branch's hunks to the REPLACEMENT, and a legitimate hunks-only landing then stops
// clearing (R8-AP). Round 7's note that this flag "cannot change a verdict" was wrong; it cannot make a branch clear that should not.
// maxBuffer is 64 MiB, like listLocalBranches always had. Node's default is 1 MiB, and a command whose output passes it throws
// ENOBUFS, which gitIn turns into "": the same answer as a real empty one. Round 5's landed-by-content check compared `git show`
// text through it, so two files over 1 MiB (the live docs/CLAIM_INVENTORY.md is 1,128,935 bytes) both read "" and "" === ""
// cleared REAL work as squash-landed. That check no longer reads file text at all (see hasLandedByContent); this is the second lock.
// GIT_EXEC_PATH and GIT_REMOTE*: where git looks for its remote helpers (git-remote-<vcs>) is the caller's to set, so a transport can be swapped under every command here (round-11 refute); git
// finds its own helpers without them.
// The variables that name a PROGRAM git runs for the transport, or where it looks for one: GIT_EXEC_PATH (remote helpers), GIT_PROXY_COMMAND (the git:// proxy), GIT_SSH_COMMAND and GIT_SSH (the ssh
// program). Each is dropped from every git started here AND named in hubTransport's row (round-18 refute: GIT_SSH_COMMAND was neither, so an exported one ran in the listing of any ssh-reached Hub).
// GIT_CONFIG joins them (round-22 refute): `git config` reads ONLY that file when it is set while `git ls-remote` ignores it, so GIT_CONFIG=/dev/null hid a global http.proxy and http.sslVerify=false from the scan
// and the listing went through that proxy. The scan and the listing must read one configuration: it is dropped, and named in the row.
// SSLKEYLOGFILE joins them (round-24 review): libcurl writes the TLS session secrets of the listing to the file it names, the GIT_TRACE_CURL of TLS.
const GIT_TRANSPORT_ENV = ["GIT_EXEC_PATH", "GIT_PROXY_COMMAND", "GIT_SSH_COMMAND", "GIT_SSH", "GIT_CONFIG", "SSLKEYLOGFILE"];
// The variables that redirect WHICH FILE OR DIRECTORY git reads repository state from (round-24 refute: GIT_SHALLOW_FILE named a forged shallow file that flipped real unpushed work to "landed", while
// shallowBounds reads `git rev-parse --git-path shallow`, which ignores it): the shallow and graft files, the index, the replace-ref base, the attribute sources, the quarantine and template directories, the
// ceiling and discovery switches, and the two paranoia switches that loosen a consistency check. Each is dropped from every git started here and from every child the check spawns, and named in the row.
// (GIT_CEILING_DIRECTORIES is set deliberately for the listing's isolated directory and for nothing else; GIT_INDEX_FILE only by the one caller that makes a throwaway index. Both arrive as `extra`, never inherited.)
// (GIT_GRAFT_FILE is not in it: the grafts check reads that variable itself, names it and refuses to confirm anything under it, cases d-G2*.)
const GIT_REDIRECT_ENV = ["GIT_SHALLOW_FILE", "GIT_INDEX_FILE", "GIT_INDEX_VERSION", "GIT_REPLACE_REF_BASE", "GIT_ATTR_SOURCE", "GIT_ATTR_GLOBAL", "GIT_ATTR_SYSTEM", "GIT_ATTR_NOSYSTEM",
  "GIT_QUARANTINE_PATH", "GIT_TEMPLATE_DIR", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_IMPLICIT_WORK_TREE", "GIT_REF_PARANOIA", "GIT_COMMIT_GRAPH_PARANOIA"];
// The variables that reach the listing's libcurl and are TRUSTED, not verified (dropping the client-certificate ones would break a legitimate mTLS user): named in the row, never judged.
const GIT_TLS_NAMED_ENV = ["GIT_PROXY_SSL_CAINFO", "GIT_PROXY_SSL_CAPATH", "GIT_PROXY_SSL_CERT", "GIT_PROXY_SSL_KEY", "GIT_SSL_CERT", "GIT_SSL_KEY", "GIT_SSL_CERT_TYPE", "GIT_SSL_KEY_TYPE", "GIT_SSL_VERSION",
  "GIT_SSL_CIPHER_LIST", "GIT_HTTP_PROXY_AUTHMETHOD", "CURL_SSL_BACKEND"];
// The tracing family writes the wire traffic of the listing (GIT_TRACE_CURL, GIT_TRACE_PACKET), the command lines and the environment to a file the CALLER names: a read-only check must not write there (round-23 review).
const isGitTraceVar = (k) => k.startsWith("GIT_TRACE") || k === "GIT_CURL_VERBOSE";
// Resource caps a caller can set to make git FAIL (round-25 refute: GIT_MMAP_LIMIT=1k made rev-parse, status, rev-list and merge-base exit 128 and a gated row went silent), and the diff-context switch.
const GIT_BEHAVIOUR_ENV = ["GIT_MMAP_LIMIT", "GIT_ALLOC_LIMIT", "GIT_DIFF_OPTS"];
//
// THE AUDIT, as a table (round 25; the 160-odd GIT_* names `strings` finds in git 2.43's binaries, classified; a reviewer diffs against this instead of re-deriving it).
//   DROPPED from every git started here and every child it spawns (gitEnv):
//     where git looks: GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES, and GIT_REDIRECT_ENV (shallow file, index file and version, replace base, attribute
//       sources, quarantine and template directories, ceiling and discovery switches, implicit work tree, the two paranoia switches);
//     what git runs: GIT_TRANSPORT_ENV (GIT_EXEC_PATH GIT_PROXY_COMMAND GIT_SSH_COMMAND GIT_SSH, GIT_CONFIG, SSLKEYLOGFILE), GIT_REMOTE*, GIT_SSL_NO_VERIFY (also a gated finding);
//     what git writes: the whole GIT_TRACE* / GIT_TRACE2* family and GIT_CURL_VERBOSE;
//     what makes git fail or print differently: GIT_BEHAVIOUR_ENV; every GIT_TEST_*.
//     The ones in GIT_TRANSPORT_ENV, GIT_REDIRECT_ENV, GIT_BEHAVIOUR_ENV, the trace family and GIT_REMOTE* are NAMED in the transport row ("not passed to any git started here").
//   FORCED: GIT_NO_REPLACE_OBJECTS=1 (replace objects off), GIT_OPTIONAL_LOCKS=0 (read-only).
//   NAMED, trusted, not verified, and passed on: GIT_SSL_CAINFO GIT_SSL_CAPATH SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE (CA), GIT_TLS_NAMED_ENV (client certificate and key, protocol version, cipher list, proxy CA, proxy
//     auth method, SSL backend), the proxy variables, and the configuration variables below.
//   KEPT, with the reason: GIT_CONFIG_COUNT / _KEY_n / _VALUE_n, GIT_CONFIG_PARAMETERS, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_CONFIG_NOSYSTEM (the listing reads them too: the scan reads them with it, in both
//     directories, and reports what it finds); GIT_GRAFT_FILE (graftsBlock reads it, names the file and refuses to confirm under it, on every path that reads ancestry to clear work); GIT_ALLOW_PROTOCOL and
//     GIT_PROTOCOL_FROM_USER and GIT_NO_LAZY_FETCH (they can only restrict: fail closed, "could not list the Hub's branches"); GIT_ASKPASS and GIT_TERMINAL_PROMPT (credential prompts: the listing is
//     non-interactive and a credential is never printed); GIT_REPLACE_REF_BASE is dropped but replace objects are off anyway.
//   UNHANDLED, VERDICT-NEUTRAL (read, and tried live by the round-10 reviewer; none changed a verdict): GIT_AUTHOR_* GIT_COMMITTER_* GIT_DEFAULT_BRANCH GIT_DEFAULT_HASH (nothing here commits or inits outside the
//     self-test), GIT_EDITOR GIT_SEQUENCE_EDITOR GIT_PAGER GIT_PAGER_IN_USE GIT_MAN_VIEWER GIT_MERGE_* GIT_MERGETOOL_GUI GIT_DIFFTOOL_* GIT_DIFF_TOOL GIT_CHERRY_PICK_HELP GIT_REFLOG_ACTION GIT_PUSH_OPTION_COUNT
//     (no interactive or porcelain command runs), GIT_EXTERNAL_DIFF (every diff here is plumbing with --no-ext-diff), GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS (the one
//     pathspec use passes --literal-pathspecs itself; a clash makes git fail, which reads as no history: not landed), GIT_NOTES_* (no notes read), GIT_FLUSH GIT_FORCE_THREADS GIT_PROGRESS_DELAY
//     GIT_PRINT_SHA1_ELLIPSIS GIT_DISABLE_UNTRACKED_CACHE GIT_FORCE_UNTRACKED_CACHE GIT_BASENAME_FACTOR GIT_USER_AGENT GIT_OVERRIDE_VIRTUAL_HOST (performance and presentation), GIT_SHELL_PATH GIT_EXT_SERVICE*
//     GIT_TRANSLOOP_DEBUG GIT_TRANSPORT_HELPER_DEBUG GIT_TEXTDOMAINDIR GIT_PREFIX GIT_SSH_VARIANT (only reached through a program already dropped), GIT_ALLOW_NULL_SHA1 (a hash-format allowance).
const GIT_ENV_DROPPED = ["GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_NAMESPACE", "GIT_SSL_NO_VERIFY", ...GIT_TRANSPORT_ENV, ...GIT_REDIRECT_ENV, ...GIT_BEHAVIOUR_ENV];
function gitEnv(extra) {
  const env = { ...process.env }; // what the CALLER exported is cleaned; what a caller of gitEnv passes (`extra`) is its own choice and is applied after
  for (const k of Object.keys(env)) if (k.startsWith("GIT_TEST_") || k.startsWith("GIT_REMOTE") || isGitTraceVar(k)) delete env[k];
  for (const k of GIT_ENV_DROPPED) delete env[k];
  return { ...env, ...extra, GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0" };
}
// { ok, status, stdout, stderr }; ok is "git ran and exited 0". stdout is a string, or a Buffer with { buffer: true }.
function gitRun(cwd, args, { input, env, buffer = false, timeout } = {}) {
  const dir = resolve(cwd);
  const r = spawnSync("git", ["-c", "core.commitGraph=false", "-C", dir, ...args], {
    cwd: dir, input, env: gitEnv(env), ...(buffer ? {} : { encoding: "utf8" }), maxBuffer: 64 * 1024 * 1024, ...(timeout ? { timeout } : {}),
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const ok = !r.error && r.status === 0;
  return { ok, error: r.error, status: r.error ? null : r.status, stdout: r.stdout ?? (buffer ? Buffer.alloc(0) : ""), stderr: String(r.stderr ?? "") };
}
const gitIn = (cwd) => (...a) => {
  const r = gitRun(cwd, a);
  return r.ok ? r.stdout.trim() : "";
};
const git = gitIn(repo);
// Untrimmed output (a diff's trailing newline is part of the patch) and a stdin feed.
const gitRaw = (cwd, args) => {
  const r = gitRun(cwd, args);
  return r.ok ? r.stdout : "";
};
const gitFeed = (cwd, args, input, env) => {
  const r = gitRun(cwd, args, { input, env });
  return r.ok ? r.stdout.trim() : "";
};
// What a path IS in a tree: { entry: "<mode> <type> <object id>" } | { missing: true } | { error: true }.
// `git ls-tree` exits 0 with NO output for a path the tree does not have and non-zero for a ref it cannot read, so a missing path
// and a git failure are different answers here; gitIn gave both as "" and the landed check read "" === "" as "identical".
// The entry carries the MODE as well as the blob id (a chmod, or a symlink whose target text equals a file's bytes, has the same
// blob id and is a different change). -z keeps the path unquoted and exact; the tab splits the entry from the path.
function entryAt(cwd, ref, file) {
  const r = gitRun(cwd, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", ref, "--", file]);
  if (!r.ok) return { error: true };
  const recs = String(r.stdout || "").split("\0").filter(Boolean);
  if (recs.length === 0) return { missing: true };
  if (recs.length > 1) return { error: true }; // a path names exactly one entry; anything else is not understood
  const m = /^(\d{6} (?:blob|commit|tree) [0-9a-f]{40,64})\t/.exec(recs[0]);
  return m ? { entry: m[1] } : { error: true };
}
// THE HUB URL AS GIT WILL REALLY USE IT (round-7 refute E2E-ls). `url.<base>.insteadOf` in ANY configuration git reads (the repository's
// own, the user's, the system's, GIT_CONFIG_*) rewrites a URL before git touches it, so `git ls-remote https://github.com/<Hub>` could be
// served by a local mirror: the listing was the mirror's, a push "succeeded" into the mirror, the origin row matched the Hub's name
// as a substring of the mirror's path, and the whole check read "✓ all present on the Review Hub" with exit 0. Two exact tests, no substring:
//   hubUrlProblem: `git ls-remote --get-url <Hub>` (the expansion git itself applies, from the same configuration the listing uses) must give
//     back the Hub URL unchanged, else the listing is not read and the row says what the URL became;
//   originRow: the origin's fetch URL and push URL, after rewriting, must be one of the spellings of the Hub (https, scp-style or ssh
//     on github.com); a mirror path, or the Hub's name inside another URL, is a failing row that names both URLs.
// The configuration is NOT switched off for the listing (GIT_CONFIG_NOSYSTEM / GIT_CONFIG_GLOBAL=/dev/null): the proxy and credential
// settings the real fetch needs live there, and the exact comparison above already sees a rewrite from every one of those sources.
//
// ROUND 9 (the transport, not only the URL). The exact URL test above says nothing about HOW the bytes travel: a repository-scope `http.proxy` (plus
// `http.sslVerify=false`) served a fake listing through a local TLS-terminating proxy with the URL untouched, and the row read "all present on the
// Review Hub" with exit 0 (round-8 refute, fx/proxy). hubTransport reads every proxy / TLS / rewrite key git will apply, WITH the scope and file each
// came from (`git config --show-origin --show-scope`), and sorts them by who can write them:
//   GATED (a failing row, the listing is not read): any http.* key (except the harmless tuning ones), core.gitProxy or url.* key at local or worktree scope
//     (a repository can carry them and a checkout does not mean they were chosen); http.sslVerify=false / http.proxySSLVerify=false at ANY scope; GIT_SSL_NO_VERIFY
//     in the environment; a rewrite of the Hub URL, at any scope (command line included), whose result is not one of the Hub's own spellings (isHubUrl:
//     same host, same repository, https / scp / ssh); a configuration git cannot read at all.
//   REPORTED, and named in the row text (the "trusted, not verified" line): the environment's proxy (HTTPS_PROXY, https_proxy, ALL_PROXY) and CA (GIT_SSL_CAINFO,
//     GIT_SSL_CAPATH), and any proxy / CA / rewrite from the user's global and system configuration or from the command line / GIT_CONFIG_* entries. These are
//     the machine's own trust boundary: the cloud sandbox's proxy and CA are exactly such environment entries, and failing on them would fail on every real run.
//     Anything a SANDBOX can plant below that boundary (the repository's own config, an included file from it, a worktree config) is gated.
const HTTP_HARMLESS = /\.(postbuffer|lowspeedlimit|lowspeedtime|maxrequests|minsessions|version|useragent|extraheader|cookiefile|savecookies|emptyauth|delegation|proactiveauth)$/; // (extraHeader: actions/checkout writes its token there, in the repository's own config; it cannot move the traffic, and its value is never printed)
// git_config_bool, exactly (config.c, git 2.43): a key with no value is true; "" is false; true/yes/on and false/no/off in any case; otherwise git_parse_int: strtoimax with base 0 (decimal, 0x hex, 0 octal, a
// leading blank, a sign), an optional k/m/g suffix (case-insensitive, x1024 each), the whole string consumed, in range; non-zero is true. Anything else git refuses ("bad boolean config value"): undefined.
// Round-23 refute: the old reading (false/no/off/0/empty) took 00, 0x0, -0, +0, 0k and 000g for TRUE, so sslVerify=00 passed the scan while git read it as off.
function gitBoolValue(raw) {
  if (raw === null) return true;
  const s = String(raw);
  if (s === "") return false;
  if (/^(true|yes|on)$/i.test(s)) return true;
  if (/^(false|no|off)$/i.test(s)) return false;
  const m = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX]([0-9a-fA-F]+)|(0[0-7]*)|([1-9][0-9]*))([kKmMgG]?)$/.exec(s);
  if (!m) return undefined;
  let n = m[2] !== undefined ? BigInt(`0x${m[2]}`) : m[3] !== undefined ? BigInt(`0o${m[3]}`) : BigInt(m[4]);
  if (m[1] === "-") n = -n;
  n *= { "": 1n, k: 1024n, m: 1048576n, g: 1073741824n }[m[5].toLowerCase()];
  return n > 9223372036854775807n || n < -9223372036854775808n ? undefined : n !== 0n;
}
// DISPLAY ONLY: never decide with it whether a URL is the Hub (round-12 refute: a span that crossed `?`, `#` and a backslash made `https://evil.example?x=@github.com/...` lose its real host and read as the Hub;
// the decisions use parseGitUrl). Here the opposite error is the one to avoid: a password may contain a raw `?`, `#` or backslash (round-15 refute: `http://agent:pw?x9@127.0.0.1:9` printed whole), so
// everything between `//` and the LAST `@` before the next `/` (or the end) is the userinfo, whatever it contains, and is not printed. The scp-style form `user:secret@host:path` loses everything up to its last
// `@` too, unless that is exactly `git@` (the conventional user, no secret; it is how the Hub's own ssh spelling reads). `all` false keeps a plain user name (`ssh://git@host/`) and removes any userinfo that has a
// `:` or a `?`, `#` or backslash in it; `all` true (a proxy, a key) removes every one, for a token can be the user name.
// Round 19: a password may hold a raw `/` too (`http://agent:pw/rest@proxy:3128`): when no `@` comes before the first `/`, an authority whose first segment has a `:` is read as user:password up to the last `@`
// of its blank-free token; and a scheme-less value (`agent:pw@127.0.0.1`, a proxy with no port) loses everything before its last `@`, unless that is exactly `git`.
const noUserinfo = (v, all = false) => {
  const s = String(v).replace(/\/\/(?:([^/]*)|([^/]*:\S*))@/g, (m, near, far) => (all || /[:?#\\/]/.test(near ?? far) ? "//" : m));
  return s.includes("://") ? s : s.replace(/^(url\.)?(\S*)@(?=\S)/, (m, key, userinfo) => (userinfo === "git" ? m : key || ""));
};
// One configuration entry (scope, origin, "key\nvalue" as `git config --show-origin --show-scope -z` prints them) -> { problem } | { trusted } | {}.
// Pure, so the scope rule is testable for a scope this git never prints: system, global and command line are the environment's; ANYTHING else (local, worktree,
// and any scope a later git adds) is the repository's own and is gated.
//
// ROUND 10 (origin inside the repository). `--show-scope` names the scope of the file that INCLUDED a key, so an include.path in the global file that points at a
// file kept inside the repository reported that file's keys as "global", and they were only reported (round-9 refute, fx/include). The signal git also gives is the
// ORIGIN path: a key whose origin file resolves (realpath) inside the worktree, its git dir or the common git dir is the repository's own whatever scope is named,
// and is gated. `own` = { fileOf(origin) -> absolute real path or "", owned: [real paths], via(file) -> "include.path in <scope> <file>" or "" }; absent, only the scope decides.
function transportKey(scope, origin, kv, own = null) {
  const nl = kv.indexOf("\n");
  const key = nl < 0 ? kv : kv.slice(0, nl), last = key.slice(key.lastIndexOf(".") + 1);
  const val = nl < 0 ? null : noUserinfo(kv.slice(nl + 1), last.includes("proxy"));
  const local = !["system", "global", "command"].includes(scope);
  const isHttp = key.startsWith("http."), isUrl = key.startsWith("url."), isProxyCmd = key === "core.gitproxy";
  // A REMOTE HELPER swaps the transport without touching the URL (round-11 refute, HIGH): `remote.<name>.vcs` makes git run `git remote-<vcs>`, which an `alias.remote-<vcs>` answers, and a remote whose NAME
  // is the Hub URL is the one `ls-remote <Hub URL>` picks. So a vcs on any remote, an alias named like a helper, and any key of a remote named like a URL, are transport overrides; as is core.sshCommand (ssh).
  const remoteName = key.startsWith("remote.") ? key.slice(7, key.lastIndexOf(".")) : "";
  const isHelper = key === "core.sshcommand" || key.startsWith("alias.remote-") || (remoteName !== "" && (last === "vcs" || /[/:@]/.test(remoteName)));
  // A credential can sit in a KEY (a url.<base> subsection named https://user:token@host/): keys are scrubbed exactly like values wherever they are printed.
  const label = `${noUserinfo(key, true)}${val === null ? "" : `=${key.startsWith("alias.") ? "(not shown)" : val}`}`;
  const where = scope === "command" ? "command line" : `${scope} ${origin.replace(/^file:/, "")}`;
  // (http.proxySSLVerify is not a key git 2.43 reads: judging it is dead but harmless, and keeps the check right for a git that does.)
  if (isHttp && (last === "sslverify" || last === "proxysslverify")) {
    const verify = gitBoolValue(nl < 0 ? null : kv.slice(nl + 1)); // (the raw value: the display copy above has had userinfo removed)
    if (verify === undefined) return { problem: `${label} (${where}) is not a boolean git can read (git refuses it), so TLS verification cannot be judged` };
    if (verify === false) return { problem: `${label} (${where}) turns TLS verification off` };
  }
  const relevant = isUrl || isProxyCmd || isHelper || (isHttp && !HTTP_HARMLESS.test(key));
  if (local && relevant) return { problem: `repository-scope ${label} (${where}) can redirect or weaken the Hub transport` };
  const file = own ? own.fileOf(origin) : "";
  if (relevant && file && own.owned.some((r) => file === r || file.startsWith(r + sep))) {
    const via = own.via(file);
    return { problem: `repository-owned ${label} (${scope} scope, but read from ${file}, a file inside the repository${via ? `, pulled in by ${via}` : ""}) can redirect or weaken the Hub transport` };
  }
  return relevant ? { trusted: `${where}: ${label}` } : {};
}
// The real paths the repository owns (worktree, git dir, common git dir), the real path of a `file:` origin, and which include line named a file.
function repoOwnership(cwd) {
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const owned = []; // (not called "roots": that name is the walker-floor gate's mark for a hand-listed walk; this list is walked by nothing, it is only searched)
  for (const a of ["--show-toplevel", "--git-common-dir"]) { // (a linked worktree's private git dir lies inside the common dir, so it needs no root of its own)
    const r = gitRun(cwd, ["rev-parse", a]);
    if (r.ok && r.stdout.trim()) { const p = real(resolve(cwd, r.stdout.trim())); if (!owned.includes(p)) owned.push(p); }
  }
  const fileOf = (origin) => { const m = /^file:(.+)$/.exec(String(origin)); return m ? real(resolve(cwd, m[1])) : ""; };
  let includes = null; // lazily: only a finding needs to name its include line
  const via = (file) => {
    if (!includes) {
      includes = new Map();
      const r = gitRun(cwd, ["config", "--show-origin", "--show-scope", "-z", "--get-regexp", "^(include\\.path|includeif\\..*\\.path)$"]);
      const t = String(r.ok ? r.stdout : "").split("\0");
      for (let i = 0; i + 2 < t.length; i += 3) {
        const from = fileOf(t[i + 1]), kv = t[i + 2], nl = kv.indexOf("\n");
        if (!from || nl < 0) continue;
        const raw = kv.slice(nl + 1), target = raw.startsWith("~/") ? join(process.env.HOME || "", raw.slice(2)) : resolve(dirname(from), raw);
        includes.set(real(target), `${kv.slice(0, nl)} in ${t[i]} ${from}`);
      }
    }
    return includes.get(file) || "";
  };
  return { owned, fileOf, via };
}
// The judgment of what git expands the Hub URL to, in the repository and in the directory the listing runs in (each a gitRun result). Pure, so the rule is testable without a configuration.
// { problems, trusted }: a failed expansion, a disagreement between the two (the only one allowed is a credential in front of the same Hub), and each expansion that is not the Hub.
function judgeExpansions(inRepo, inListing, hub = HUB) {
  const problems = [], trusted = [];
  const failed = (r, where) => `git could not expand the Hub URL${where} (${String(r.stderr).split("\n").find(Boolean) || `exit ${r.status}`})`;
  if (!inRepo.ok) problems.push(failed(inRepo, ""));
  if (!inListing.ok) problems.push(failed(inListing, " where the listing is read"));
  const a = inRepo.ok ? String(inRepo.stdout).replace(/\n$/, "") : null, b = inListing.ok ? String(inListing.stdout).replace(/\n$/, "") : null; // as git printed it: a leading blank is part of the URL
  const sameHub = a !== null && b !== null && isHubUrl(a, hub) && isHubUrl(b, hub) && urlWithoutUserinfo(a) === urlWithoutUserinfo(b);
  const disagreement = a !== null && b !== null && a !== b && !sameHub ? `git expands the Hub URL ${hub} to ${displayUrl(a) || "(nothing)"} in the repository but to ${displayUrl(b) || "(nothing)"} where the listing is read (an empty directory, the clean environment): a configuration that applies in only one of the two places (an includeIf, a gitdir or hasconfig test), so the listing is not asked for` : "";
  const classify = (expanded, where) => {
    // userinfo is never printed (a token-bearing insteadOf is common and legitimate), and a rewrite whose result is the Hub URL once the credentials are removed is no finding
    const shown = displayUrl(expanded);
    if (expanded === hub) { /* no rewrite */ }
    else if (!isHubUrl(expanded, hub)) problems.push(`git configuration rewrites the Hub URL ${hub} to ${shown || "(nothing)"} (url.<base>.insteadOf${where}), so the listing would be read from there and not from the Hub`);
    else if (urlWithoutUserinfo(expanded) === urlWithoutUserinfo(hub) && parseGitUrl(expanded).scheme === parseGitUrl(hub).scheme) trusted.push("a url.<base>.insteadOf adds credentials to the Hub URL (not shown)");
    else trusted.push(`a url.<base>.insteadOf rewrites the Hub URL to ${shown} (same host and repository)`);
  };
  if (a !== null) classify(a, ""); // (the repository's own rewrite first: it is the one a reader of the row looks for)
  if (disagreement) problems.push(disagreement);
  if (b !== null && b !== a) classify(b, "; read where the listing is");
  return { problems, trusted };
}
// A fresh empty directory under the temp directory, with nothing above it a repository (GIT_CEILING_DIRECTORIES): the place the listing runs in, and the place its expansion and configuration are read.
// GIT_CEILING_DIRECTORIES is a colon-separated list: a temp directory whose real path holds a `:` (or a NUL or newline) would silently drop the ceiling, and a repository above it could then be found (round-22
// review). Fail closed: `refused(why)` is what the caller returns instead of running anything.
function inIsolatedDir(fn, refused = (why) => { throw new Error(why); }) {
  const ceiling = realpathSync(tmpdir());
  if (/[:\0\n]/.test(ceiling)) return refused(`refusing to run git in an isolated directory: the real path of the temporary directory (${JSON.stringify(ceiling)}) holds a ":", NUL or newline, which GIT_CEILING_DIRECTORIES (a colon-separated list) cannot carry, so nothing would stop git from finding a repository above it`);
  const dir = mkdtempSync(join(tmpdir(), "loop-state-ls-"));
  try {
    return fn(dir, { GIT_CEILING_DIRECTORIES: ceiling });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* a throwaway empty directory */ }
  }
}
function hubTransport(cwd = repo, hub = HUB) {
  const problems = [], trusted = [];
  const env = process.env;
  if ("GIT_SSL_NO_VERIFY" in env) problems.push("GIT_SSL_NO_VERIFY is set in the environment (TLS verification is off for any git this session starts; this check ignores it, a fetch or push of yours would not)");
  const proxies = new Map(); // one entry per value: HTTPS_PROXY and https_proxy are nearly always the same
  for (const k of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) if (env[k]) { const v = noUserinfo(env[k], true); proxies.set(v, [...(proxies.get(v) || []), k]); }
  for (const [v, ks] of proxies) trusted.push(`environment proxy ${ks.join("/")}=${v}`);
  for (const k of ["GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE"]) if (env[k]) trusted.push(`environment CA ${k}=${env[k]}`);
  for (const k of GIT_TLS_NAMED_ENV) if (env[k]) trusted.push(`environment TLS ${k}=${env[k]}`); // (a client certificate, a protocol version, a cipher list, a proxy CA: trusted, not verified)
  // Where git looks for its remote helpers: named, and never passed on (gitEnv drops it), so it can swap no transport here.
  // (a command line is shown by its program alone: its arguments can carry a credential)
  const shownEnv = (k, v) => { const w = String(v).trim().split(/\s+/); return k === "GIT_SSH_COMMAND" || k === "GIT_PROXY_COMMAND" ? `${w[0]}${w.length > 1 ? " ..." : ""}` : String(v); };
  for (const k of Object.keys(env)) if (GIT_TRANSPORT_ENV.includes(k) || GIT_REDIRECT_ENV.includes(k) || GIT_BEHAVIOUR_ENV.includes(k) || k.startsWith("GIT_REMOTE") || isGitTraceVar(k)) trusted.push(`environment ${k}=${shownEnv(k, env[k])} (not passed to any git started here)`);
  // The configuration and the Hub URL's expansion are read in TWO places, never one (round-21 refute): the repository (what a fetch or a push of yours sees) and the directory the listing runs in (an empty
  // temporary directory, the clean environment: what the listing sees). A global `[includeIf "gitdir:<repo>/"]` that pulls in an identity insteadOf for the full Hub URL applies only inside the repository, so
  // the gate saw no rewrite there while a shorter global rewrite served the listing from another machine. The two expansions must agree (a credential in front of the same Hub is the one difference allowed),
  // anything else is a gated finding naming both, and the keys of both places are scanned.
  const readConfig = (dir, cfgEnv, isRepo) => {
    const found = { problems: [], seen: new Map() };
    const cfg = gitRun(dir, ["config", "--show-origin", "--show-scope", "-z", "--get-regexp", "^(http\\.|core\\.gitproxy$|core\\.sshcommand$|url\\.|alias\\.remote-|remote\\.)"], { env: cfgEnv });
    if (!cfg.ok && !(cfg.status === 1 && !String(cfg.stdout).trim())) {
      found.problems.push(`git could not read its configuration (${String(cfg.stderr).split("\n").find(Boolean) || `exit ${cfg.status}`}), so no proxy / TLS / rewrite setting could be checked`);
      return found;
    }
    const t = String(cfg.stdout).split("\0"); // scope \0 origin \0 key \n value \0, repeated
    const own = isRepo ? repoOwnership(dir) : null; // (the listing's directory is no repository: scope alone decides there, and no local scope exists)
    // FLOOR: a repository has at least a worktree or a git dir. Fewer means git could not name them, and then no key can be recognised as read from a file inside the repository
    // (the origin test above would match nothing and say nothing): that is a finding, not a pass.
    if (own && own.owned.length < 1) found.problems.push("git could not name the repository's own paths (rev-parse failed), so a setting read from a file inside it cannot be told from the environment's");
    for (let i = 0; i + 2 < t.length; i += 3) {
      const f = transportKey(t[i], t[i + 1], t[i + 2], own);
      if (f.problem) found.problems.push(f.problem);
      else if (f.trusted) found.seen.set(f.trusted, (found.seen.get(f.trusted) || 0) + 1);
    }
    if (isRepo) { // an include whose condition depends on the STATE of the repository (the branch checked out, a remote's URL) is not the same configuration in every state: the scan sees one of them
      const inc = gitRun(dir, ["config", "--show-origin", "--show-scope", "-z", "--get-regexp", "^includeif\\..*\\.path$"]);
      const u = String(inc.ok ? inc.stdout : "").split("\0");
      for (let i = 0; i + 2 < u.length; i += 3) {
        const key = u[i + 2].split("\n")[0], cond = key.slice("includeif.".length, key.lastIndexOf("."));
        if (!/^(onbranch|hasconfig):/i.test(cond)) continue;
        const local = !["system", "global", "command"].includes(u[i]), where = `${u[i]} ${u[i + 1].replace(/^file:/, "")}`;
        if (local) found.problems.push(`repository-scope includeIf "${cond}" (${where}) pulls in configuration that applies only in some states of the repository, so what was scanned is not all that can apply`);
        else found.seen.set(`${where}: includeIf "${cond}" (configuration that applies only in some states of the repository is not evaluated here)`, 1);
      }
    }
    return found;
  };
  const repoCfg = readConfig(cwd, undefined, true), repoExp = gitRun(cwd, ["ls-remote", "--get-url", hub]);
  const listing = inIsolatedDir((dir, isoEnv) => ({ cfg: readConfig(dir, isoEnv, false), exp: gitRun(dir, ["ls-remote", "--get-url", hub], { env: isoEnv }) }),
    (why) => ({ cfg: { problems: [], seen: new Map() }, exp: { ok: false, status: null, stdout: "", stderr: why } }));
  const seenAll = new Map(repoCfg.seen);
  for (const [k, n] of listing.cfg.seen) if (!seenAll.has(k)) seenAll.set(k, n);
  for (const pr of [...repoCfg.problems, ...listing.cfg.problems]) if (!problems.includes(pr)) problems.push(pr);
  for (const [k, n] of seenAll) trusted.push(`${k}${n > 1 ? ` (x${n})` : ""}`);
  const judged = judgeExpansions(repoExp, listing.exp, hub);
  problems.unshift(...judged.problems);
  for (const t of judged.trusted) if (!trusted.includes(t)) trusted.push(t);
  return { problems, trusted, note: trusted.length ? `trusted, not verified: ${trusted.join("; ")}` : "no proxy, CA or URL rewrite configured; direct" };
}
// THE LISTING ITSELF. Every setting a repository can carry (a remote helper named by `remote.<Hub URL>.vcs`, a proxy, an insteadOf, core.sshCommand, an include) reaches `git ls-remote` through the repository
// it runs in, and hubTransport can only name the shapes it knows. So the listing runs in a fresh empty directory (nothing above it may be a repository: GIT_CEILING_DIRECTORIES), where only the
// environment's own configuration (global, system, GIT_CONFIG_*) and environment exist; the scan above still names what the repository carries. (Round-11 refute: remote.<Hub URL>.vcs plus an inline
// alias.remote-<vcs> served a fake listing from repository configuration alone.) The isolation is DEFENCE IN DEPTH behind the scan: every repository-scope shape the scan enumerates is gated before the
// listing is asked for, so the cases that pin it use what the scan cannot see (a rewrite written into .git/config AFTER the scan took its snapshot) and watch where the listing runs (R16-listhub-*).
function listHub(hub = HUB) {
  return inIsolatedDir((dir, isoEnv) => gitRun(dir, ["ls-remote", "--heads", hub], { timeout: 60000, env: isoEnv }), (why) => ({ ok: false, error: undefined, status: null, stdout: "", stderr: why }));
}
function hubUrlProblem(cwd = repo, hub = HUB) {
  return hubTransport(cwd, hub).problems.join("; ");
}
// The row for a listing that WAS read. Green only when nothing was taken on trust: no proxy, no CA override and no rewrite at any scope. Anything listed under
// "trusted, not verified" (the cloud sandbox's own proxy and CA always are) is a warning, never gating, so it stands out instead of reading like a clean pass
// (round-9 refute: a global proxy plus an environment CA served a fake listing and the row was a green tick).
function transportRow(scan, hub = HUB) {
  const clean = scan.trusted.length === 0;
  return {
    state: clean ? "ok" : "warn", what: "Review Hub transport", gated: false,
    // (the contract, stated: a proxy or a CA bundle that the environment's own configuration or command line sets is trusted and reported, not verified; only a switch that turns verification off is a finding)
    detail: clean ? `listing read from ${hub}; ${scan.note}` : `listing read from ${hub} through a transport this check cannot verify; ${scan.note}; by design a proxy or CA bundle set by the environment's own configuration or command line (http.proxy, http.sslCAInfo, GIT_SSL_CAINFO, SSL_CERT_FILE) is trusted, not verified`,
  };
}
// IS THIS URL THE HUB: decided by PARSING, never by a pattern over the string. A regex that strips "userinfo" read `https://evil.example?x=@github.com/<Hub>.git` as the Hub (its real host is
// evil.example: everything after the first `?` is a query), and so did `#@` and a backslash; the origin row passed, a global insteadOf was classed as "adds credentials", and the Hub LISTING was
// fetched from the other machine (round-12 refute). parseGitUrl gives { scheme, host, path } for exactly the shapes git itself treats as an https URL, an ssh:// URL or an scp-style address, with
// the userinfo taken out by the PARSER (the WHATWG URL for the first two), and gives null for everything else: whitespace or control characters, a backslash, a query or a fragment (a Hub URL has
// none), a scheme that is not https or ssh, a port that is not the scheme's own, an unparseable string. null is "not the Hub" (fail closed).
// And only AS WRITTEN, the way git reads it (round-18 refute): the WHATWG parser lower-cases the scheme, but git's native-transport test is case-sensitive, so `HTTPS://github.com/<Hub>` makes git run a helper called
// git-remote-HTTPS found on PATH (and `SSH://` one called git-remote-SSH): not the Hub. Likewise the string is not trimmed: a leading blank makes git read a relative path, and the old trim hid a rewrite to one.
function parseGitUrl(u) {
  const s = String(u ?? "");
  if (!s || /[\s\\?#\u0000-\u001f\u007f]/.test(s)) return null;
  const written = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (written) {
    if (written[1] !== written[1].toLowerCase()) return null;
    // git url-decodes an ssh:// URL before it splits off the host (connect.c parse_connect_url), the WHATWG parser keeps the escapes in the userinfo: `ssh://evil.example%2f@github.com/<Hub>` is host github.com
    // here and evil.example there (round-19 refute). Refuse, never decode: a `%` anywhere in the authority, for every scheme, is not the Hub.
    if (s.slice(written[0].length).split("/")[0].includes("%")) return null;
    if (/[\[\]]/.test(s.slice(written[0].length).split("/")[0])) return null; // (round 20, belt and braces: git reads a leading `[` as an IPv6 bracket; isHubUrl's allowlist is the rule)
    let url; try { url = new URL(s); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "ssh:") return null;
    if (url.search || url.hash || !url.hostname) return null;
    if (url.port && url.port !== (url.protocol === "https:" ? "443" : "22")) return null;
    return { scheme: url.protocol.slice(0, -1), host: url.hostname.toLowerCase(), path: url.pathname.replace(/^\/+/, "") };
  }
  const m = /^(?:[^@/:]+@)?([^@/:]+):([^:@]+)$/.exec(s); // scp-style [user@]host:path, no "//" and no "/" before the colon
  if (!m || m[2].startsWith("/")) return null;
  return { scheme: "scp", host: m[1].toLowerCase(), path: m[2] };
}
const hubIdentity = (p) => (p ? `${p.host}/${p.path.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase()}` : null);
// Is `u` an https, ssh or scp-style spelling of the Hub URL asked about (host and repository come from `hub`, never from a literal here: the self-test asks about a reserved-host Hub)?
// THE RULE (round 20, after the scheme case, the percent-escape and the bracket each turned out to be a way for the parser and git to read one authority two ways): a URL is the Hub only when its
// authority, AS WRITTEN, is one of the Hub's own spellings, decided on the raw string before and whatever any parser yields (the parser supplies the path and nothing else):
//   https://   exactly the Hub's host, or a plain credential in front of it (user or user:password, letters digits . _ ~ - only: a bracket, a %, an @, a blank or a second colon never qualifies);
//   ssh://     exactly git@<host>;      scp-style  exactly git@<host> before the colon.
// No port, no other user, no brackets, no %, no blank, no case variation, no trailing dot: any other authority is NOT the Hub. The checks in parseGitUrl stay as belt and braces.
function authorityIsHubs(u, host) {
  const s = String(u ?? ""), m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/.exec(s);
  if (m) {
    const [, scheme, auth] = m;
    if (scheme === "ssh") return auth === `git@${host}`;
    if (scheme !== "https") return false;
    if (auth === host) return true;
    const at = auth.indexOf("@");
    return at > 0 && auth.indexOf("@", at + 1) < 0 && /^[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]*)?$/.test(auth.slice(0, at)) && auth.slice(at + 1) === host;
  }
  if (s.includes("://")) return false;
  const colon = s.indexOf(":");
  return colon > 0 && s.slice(0, colon) === `git@${host}`;
}
// The PATH too, as written (round-21 review): /<owner>/<repo>, optionally a trailing slash, segments of letters digits . _ - only, none of them `.` or `..`, no %, no empty segment. The WHATWG parser
// normalises `//owner/repo`, `/../owner/repo` and `/%2e%2e/owner/repo` into the Hub's path; git hands the string on as written.
function pathIsPlain(u) {
  const s = String(u ?? ""), m = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/.exec(s);
  if (!m && s.includes("://")) return false;
  const path = m ? m[1] ?? "" : s.slice(s.indexOf(":") + 1);
  if (m && !path.startsWith("/")) return false;
  const segments = (m ? path.slice(1) : path).replace(/\/$/, "").split("/");
  return segments.length === 2 && segments.every((x) => /^[A-Za-z0-9._-]+$/.test(x) && x !== "." && x !== "..");
}
function isHubUrl(u, hub = HUB) {
  const hp = parseGitUrl(hub), want = hubIdentity(hp);
  return want !== null && authorityIsHubs(u, hp.host) && pathIsPlain(u) && hubIdentity(parseGitUrl(u)) === want;
}
// The URL without its userinfo, taken out by the parser: the same string for the Hub with and without credentials, so "only adds credentials" is a comparison, not a guess. null when unparseable.
function urlWithoutUserinfo(u) {
  const p = parseGitUrl(u);
  return p ? `${p.scheme}://${p.host}/${p.path}` : null;
}
// A URL for a row, printing LESS rather than more. Where the string parses, the PARSER's host, path and scheme as written are shown (so a URL that hides another host behind `?x=@` shows the host it goes to),
// the userinfo is whatever the parser took, and a query or fragment is shown only as `?...` / `#...` (text there may be a mis-encoded credential); when that text holds an `@` the port is left out too, for a
// password that starts with digits would read as one. Everything else goes through noUserinfo. A URL with a leading or trailing blank says so.
function displayUrl(u) {
  const raw = String(u ?? ""), s = raw.trim(), blank = raw === s ? "" : " (as written, with leading or trailing whitespace)";
  const written = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (written && ((a) => /[%\[\]\s]/.test(a) || a.split("@").length > 2)(s.slice(written[0].length).split("/")[0])) {
    // an authority with a percent-escape git decodes, a bracket git reads as IPv6, a second @ or a blank: the parser's host is not where git goes. Show the authority AS WRITTEN (user:password becomes user:***), path, `?...`.
    const rest = s.slice(written[0].length), auth = rest.split("/")[0], at = auth.lastIndexOf("@"), userinfo = at < 0 ? "" : auth.slice(0, at);
    const bracket = /^(\[[^\]]*\])(.*)$/.exec(userinfo), [head, tail] = bracket ? [bracket[1], bracket[2]] : ["", userinfo]; // (a bracketed name is shown whole: what is inside is not a password)
    const shownUserinfo = at < 0 ? "" : `${head}${tail.includes(":") ? `${tail.slice(0, tail.indexOf(":"))}:***` : tail}@`;
    return `${written[1]}://${shownUserinfo}${auth.slice(at + 1)}${rest.slice(auth.length).replace(/([?#]).*$/, "$1...")}${blank}`;
  }
  if (written) {
    try {
      const x = new URL(s), ambiguous = `${x.search}${x.hash}`.includes("@");
      return `${written[1]}://${ambiguous ? x.hostname : x.host}${x.pathname}${x.search ? "?..." : ""}${x.hash ? "#..." : ""}${blank}`;
    } catch { /* below */ }
  }
  return `${noUserinfo(s, true)}${blank}`;
}
function originRow(cwd = repo, hub = HUB) {
  // the URLs as git prints them, only the final newline removed (gitIn trims, and a leading blank is part of the URL)
  const asWritten = (...a) => { const r = gitRun(cwd, a); return r.ok ? r.stdout.replace(/\n$/, "") : ""; };
  const configured = asWritten("config", "--get", "remote.origin.url"), fetchUrl = asWritten("remote", "get-url", "origin"), pushUrl = asWritten("remote", "get-url", "--push", "origin");
  const ok = isHubUrl(fetchUrl, hub) && isHubUrl(pushUrl, hub);
  const pushNote = pushUrl && pushUrl !== fetchUrl ? ` (pushes to ${displayUrl(pushUrl)})` : "";
  const rewriteNote = configured && configured !== fetchUrl ? ` (remote.origin.url is ${displayUrl(configured)}, rewritten by url.<base>.insteadOf)` : "";
  // a URL that is not the Hub as written can print as the Hub once what precedes an @ is left out: say so, so a failing row never reads like a passing one
  const hidden = !ok && [fetchUrl, pushUrl].some((x) => x && !isHubUrl(x, hub) && hubIdentity(parseGitUrl(displayUrl(x))) === hubIdentity(parseGitUrl(hub))) ? " (not the Hub as written: text before an @ is not shown)" : "";
  return { state: ok ? "ok" : "fail", what: "origin points at the Review Hub", detail: `${displayUrl(fetchUrl) || "(no origin)"}${pushNote}${rewriteNote}${hidden}` };
}
// A FULL refname, never `origin/SignalGrid_Alpha`: a tag called origin/SignalGrid_Alpha outranks the
// remote-tracking ref in a bare resolution, and every landed check below would then compare a local
// branch against the tag's commit, not against mainline.
const MAINLINE = "refs/remotes/origin/SignalGrid_Alpha";
// Is the local tracking ref `mainline` really the Hub's branch of that name, or a lagging copy of it? Every landed exemption and the scratch declaration read their "mainline" from this
// LOCAL ref, and anyone can write one (round-11 refute: `merge --squash` on a throwaway branch, `update-ref refs/remotes/origin/SignalGrid_Alpha`, `branch -D`: the unpushed branch read
// "squash-landed" with exit 0). So it must equal the sha the Hub LISTS for that name, or be an ancestor of it with every commit on the way re-hashed (tipReachableFromAny/chainIsReal), and the
// Hub's commit must be in this checkout. Anything else is not mainline: the exemptions and the declaration are off, with the remedy (a fetch settles every honest case).
// { ok, reason } where reason is a sentence for the row.
function mainlineAnchor(cwd, hubShaMap, mainline = MAINLINE) {
  const name = mainline.startsWith("refs/remotes/origin/") ? mainline.slice("refs/remotes/origin/".length) : "";
  const off = (why) => ({ ok: false, reason: `${mainline.replace(/^refs\/remotes\//, "")} is not confirmed as the Hub's ${name || "mainline"}: ${why}` });
  if (!name) return off("it is not a refs/remotes/origin/<name> ref");
  const grafted = graftsBlock(cwd);
  if (grafted) return off(grafted);
  if (!(hubShaMap instanceof Map)) return off("there is no Hub sha map");
  const hub = hubShaMap.get(name);
  if (typeof hub !== "string" || !hub) return off(`the Hub lists no ${name}`);
  const tip = gitIn(cwd)("rev-parse", "--verify", "-q", `${mainline}^{commit}`);
  if (!tip) return off("the ref does not resolve to a commit");
  if (!localCommits(cwd, [hub]).has(hub)) return off(`the Hub's ${name} (${hub.slice(0, 12)}) is not fetched here: run git fetch origin, then re-run`);
  if (tip === hub) return { ok: true, reason: "" };
  return tipReachableFromAny(cwd, tip, [hub]) === true ? { ok: true, reason: "" } : off(`it (${tip.slice(0, 12)}) is neither the Hub's ${hub.slice(0, 12)} nor an ancestor of it: run git fetch origin, then re-run`);
}
// The scratch declaration, read from mainline only while mainline is anchored. Returns the evaluation and, when a declaration is there but cannot be trusted, the row that says so.
function mainlineScratch(cwd, hubShaMap, localBranches, mainline = MAINLINE) {
  const anchor = mainlineAnchor(cwd, hubShaMap, mainline);
  if (anchor.ok) return { scratch: evaluateScratch(mainline, cwd, localBranches), anchor, row: null };
  const none = { exists: false, ok: true, excluded: [], reopened: [], stale: [] };
  const declared = readMainlineDeclaration(mainline, cwd) !== null; // information only: nothing read from it is acted on
  return { scratch: none, anchor, row: declared ? { state: "warn", what: "Declared scratch branches", detail: `NOT read — ${anchor.reason}; no branch is excluded as scratch until then`, gated: false } : null };
}
// Every git argument that names a LOCAL branch is headRef(name), never the bare name (see listLocalBranches).
const HEADS = "refs/heads/";
const headRef = (name) => `${HEADS}${name}`;
// The two warnings `git for-each-ref` prints when it SKIPS a ref it cannot read (see listLocalBranches); anchored on the wording.
const REF_SKIP_WARNING = /^warning: ignoring (broken ref|ref with broken name)\b/;
const SCRATCH_FILE = "docs/agent/local-scratch-branches.json";
// Bounded walk of mainline history for the landed checks: an unbounded walk is a check
// nobody waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared.
const MAX_HISTORY = 400;

if (process.argv.includes("--self-test")) process.exit(selfTest());

console.log(`\n${B}Loop check${X} ${D}— reality, not notes${X}\n`);

// ── 1. Does local work exist that the Review Hub has never seen? ────────────
// This is the check that would have caught the lost week.
// The list is built from FULL refnames (see listLocalBranches); a failed listing is a reported failure
// (branchListRow), never an empty clean list.
const listing = listLocalBranches(repo);
const localBranches = listing.names;
let hubBranches = [];
const hubSha = new Map();
let hubListed = false;
const hubScan = hubTransport(repo);
const hubUrlTrouble = hubScan.problems.join("; ");
if (hubUrlTrouble) {
  // not listed at all: a listing read from somewhere that is not the Hub is worse than none
  add("fail", "Review Hub URL", `${hubUrlTrouble} — the unpushed-work check did NOT run; unknown is not clean${hubScan.trusted.length ? ` (${hubScan.note})` : ""}`);
} else try {
  // through gitRun like every other git here (the guarded environment, `-C <repo>`), never a bare spawn that reads GIT_DIR from the caller
  const ls = listHub(HUB);
  if (!ls.ok) throw new Error(String(ls.stderr).split("\n").find(Boolean) || `exit ${ls.status}`);
  const heads = String(ls.stdout).split("\n").filter(Boolean).map((l) => l.split(/\s+/)).filter((p) => p[1] && p[1].startsWith("refs/heads/"));
  for (const [sha, ref] of heads) hubSha.set(ref.slice("refs/heads/".length), sha);
  hubBranches = [...hubSha.keys()];
  hubListed = true;
  { const tr = transportRow(hubScan); add(tr.state, tr.what, tr.detail, tr.gated); }
} catch {
  // FAIL, not warn. An unreachable Hub means the unpushed-work check below did
  // not run, and "the check that would have caught the lost week did not run"
  // is a failing state, not a shrug. The old `warn` plus the `if
  // (hubBranches.length)` guard turned an empty ls-remote into a clean report —
  // an empty collection concluding no objection, exactly when the network was
  // the unverifiable input.
  add("fail", "Review Hub reachable", "could not list the Hub's branches — the unpushed-work check did NOT run; unknown is not clean");
}

// ...and the half of that fix which did NOT land. The comment above says the `if
// (hubBranches.length)` guard "turned an empty ls-remote into a clean report", and
// the guard was still here: a command that SUCCEEDS and returns nothing throws no
// exception, so `hubBranches` was empty, no fail row was added, and the unpushed-work
// check plus the origin check were both skipped in silence. That is the same empty
// collection concluding no objection, one layer down — and it is the realistic
// failure (an HTTP proxy answering 200 with an empty body, a misspelled remote that
// resolves, a repo genuinely carrying no heads), not the clean throw.
//
// Success and emptiness are now different answers. A Hub that lists ZERO branches is
// a broken read, never a clean one.
if (hubListed && hubBranches.length === 0) {
  add(
    "fail",
    "Review Hub branch list",
    "git ls-remote --heads succeeded but returned ZERO branches — the unpushed-work check did NOT run. " +
      "An empty answer is not a clean answer.",
  );
}
{
  const r = branchListRow(listing);
  if (r) add(r.state, r.what, r.detail, r.gated);
}

// ── Local branches, as FULL refnames ─────────────────────────────────────────
// `git branch --format=%(refname:short)` is not a list of branch names. When a TAG shares a branch's
// name, git shortens the BRANCH to `heads/<name>` (the shortest form that is not ambiguous), and
// `heads/<name>` is a name no refs/heads/ entry carries: round 3 then asked about `refs/heads/heads/<name>`,
// which never exists, so a branch sitting exactly at its Hub tip with a same-named tag FAILED the unpushed
// seam and could not be cleared, and (contrived) real unpushed work on refs/heads/X next to a Hub branch
// literally called heads/X was demoted from a gated AHEAD to a non-gated "not fetched locally" warning.
// `%(refname:lstrip=2)` is no fix on its own: the bare name X it returns resolves the TAG in every git
// argument that is not qualified, and a tag on a commit whose bytes are in mainline then cleared real
// unpushed work as "squash-landed".
//
// So the listing asks for %(refname), the display/short name is the string after "refs/heads/" (it never
// changes under a tag, and it is the same key the Hub map uses: ls-remote names are stripped the same way),
// and EVERY git argument that names a local branch is headRef(name), never the bare name.
//
// The listing is fail-closed too: a git error, a spawn error, a non-zero exit, an `error:`/`fatal:` line, or
// one of the two warnings for-each-ref prints WHEN IT SKIPS A REF is `ok:false`. for-each-ref SKIPS a broken
// ref with only a warning ("ignoring broken ref" / "ignoring ref with broken name") and exits 0, so the exit
// code alone would read a branch git could not read as a branch that does not exist.
//
// Any OTHER `warning:` is not about the refs and is not a reason to withhold the verdict. Round 4 failed the
// listing on ANY `warning:` line, and a deprecated config key in a dotfile (`core.fsyncObjectFiles=true`
// prints "warning: core.fsyncObjectFiles is deprecated; use core.fsync instead" on every git command, exit 0)
// then turned every session red with a false "checks did NOT run". Measured on git 2.43 (LC_ALL=C): the only
// warnings for-each-ref prints about the refs it lists are the two ref-skip ones below; a dangling symref and
// a *.lock file are dropped silently; `hint:` and GIT_TRACE lines never start with `warning:`. So the ref-skip
// warnings are anchored on their WORDING, and every other warning is carried on `warnings` and printed in the
// detail of the row built from this listing (branchSeamRows), named, never swallowed and never failing it.
function listLocalBranches(cwd = repo) {
  // the warning prefixes below are matched in English
  const r = gitRun(cwd, ["for-each-ref", "--format=%(refname)", HEADS], { env: { LC_ALL: "C", LANGUAGE: "C" } });
  const fail = (error) => ({ ok: false, refs: [], names: [], error });
  if (r.error) return fail(String(r.error.message || r.error).split("\n")[0]);
  const lines = r.stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const hard = lines.find((l) => /^(error|fatal):/.test(l) || REF_SKIP_WARNING.test(l));
  if (r.status !== 0) return fail(hard || `git exited ${r.status}`);
  if (hard) return fail(hard);
  const refs = String(r.stdout || "").split("\n").filter(Boolean);
  const stray = refs.find((x) => !x.startsWith(HEADS) || x.length === HEADS.length);
  if (stray !== undefined) return fail(`unexpected refname in a refs/heads listing: ${stray}`);
  return { ok: true, refs, names: refs.map((x) => x.slice(HEADS.length)), warnings: [...new Set(lines.filter((l) => l.startsWith("warning:")))] };
}
function branchListRow(l) {
  if (l.ok) return null;
  return {
    state: "fail",
    what: "Local branch list unreadable",
    detail: `git for-each-ref refs/heads failed (${l.error}) — the unpushed-work and same-name checks did NOT run; an unreadable list is not an empty one`,
    gated: true,
  };
}

/**
 * Every branch checked out in an agent's isolated worktree, derived from
 * `git worktree list` rather than from the branch's NAME.
 *
 * WHY THE NAME WAS THE WRONG KEY. The rule below used to be
 * `b.startsWith("worktree-agent-")`, which catches only the branches the Agent
 * tool names itself. It missed two shapes that occur constantly:
 *
 *   - a sub-agent that creates its OWN branch inside its worktree, because the
 *     branch it was told to use is already checked out elsewhere (`wt-...`);
 *   - a deliberate ATTACK reproduction (`attack-b1`), built to prove a gate
 *     wrongly approves a weakening — on 2026-09-14 one such branch carried a
 *     neutered prototype-depth bound.
 *
 * Both failed this seam on every session, and neither could be cleared: the
 * message offers "push, or confirm the remote", and pushing is WRONG for both —
 * it puts scratch names on the shared remote for the Mac lane to prune, and in
 * the attack case it publishes a disabled safety guard indistinguishable at a
 * glance from real work. The only other move is deleting a branch out from under
 * a running agent. A seam whose every remedy is wrong is one a session learns to
 * narrate past, which is how a real unpushed branch would eventually slip by.
 *
 * So membership is derived from WHERE a branch lives. An agent can rename its
 * branch; it cannot escape its worktree.
 */
/**
 * Has this branch's content already landed on mainline?
 *
 * TRUE only when every path the branch changes relative to its merge base has the very same tree entry
 * (mode and object id) on mainline, or had it in a mainline commit made AFTER the branch forked
 * (fileEverMatchedMainline). That is what survives a SQUASH merge, which rewrites the commit and defeats
 * `merge-base --is-ancestor`.
 *
 * It compares OBJECT IDS, never file text. Round 5 compared the trimmed text of `git show` through gitIn, which had
 * no maxBuffer: a file over 1 MiB threw ENOBUFS on both sides, both read "", and "" === "" cleared real work (the
 * live docs/CLAIM_INVENTORY.md is 1,128,935 bytes); a trim-only difference (indentation, trailing blank lines in
 * YAML) read byte-identical too. A path the tree does not have is a distinct answer (entryAt), not an empty file:
 *   · missing on BOTH sides is the same state (the branch deleted a file mainline also deleted: cleared);
 *   · missing on the branch only is a difference (the branch deletes what mainline still has: reported);
 *   · missing on mainline only falls through to the history check (mainline may have landed the content and removed it).
 * The path list is `diff-tree -r -z --no-renames`: plumbing, because the porcelain `git diff` honours diff.ignoreSubmodules=all
 * and hides a gitlink bump; -z because git QUOTES a path like "\303\244.txt" in plain output and a quoted name is missing on both
 * sides; --no-renames because round 6 learned that a rename is listed under its NEW name only (so the half that deletes the old
 * path was never compared). diff-tree detects no renames unless asked, which makes the flag documentation here, not a guard: no
 * mutant of it can die, and none is claimed.
 *
 * Fail-closed in every direction: an unreadable diff, an unreadable entry on either side (any git error), a grafts file in
 * force, an entry that differs and never appeared on mainline since the fork all return false, and the branch stays reported
 * as unpushed. What this does NOT say is that the work reached the Hub: it reads the local refs/remotes mainline ref.
 */
function hasLandedByContent(branch, mainline = MAINLINE, cwd = repo, trace = null) {
  // Every exemption that rests on mainline's HISTORY is off while a grafts file is in force: a graft line `S1 Q` splices a local copy Q of the
  // branch's work into the history this walks (round-6 refute GL2), and the row printed "graft file present" while it cleared real work.
  if (graftsBlock(cwd)) return false;
  const tip = headRef(branch);
  // (No shallowBounds check here: an entry byte-identical to mainline's CURRENT one needs no history, and every walk that does -- fileEverMatchedMainline
  // for an entry that differs -- applies shallowBounds itself. The path list below may be LONGER under a cut, never shorter: a common ancestor visible
  // under a cut is a real one, and the merge base is then at most as new as the real one.)
  const base = gitIn(cwd)("merge-base", mainline, tip);
  if (!base) return false;
  // The path list is PLUMBING: `git diff` (porcelain) honours diff.ignoreSubmodules=all and left a bumped gitlink out of the list, so a
  // branch that bumped a submodule pointer to a commit nobody pushed AND changed a landed file read landed (round-6 refute B2).
  // diff-tree reads no such configuration; --ignore-submodules=none says so anyway.
  const raw = gitRaw(cwd, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", "--ignore-submodules=none", "--no-ext-diff", base, tip]);
  const files = raw.split("\0").filter(Boolean);
  // A branch that touches nothing is not evidence of landing — it is an unreadable
  // diff, or a branch identical to its base. Say nothing rather than clear it.
  if (files.length === 0) return false;
  for (const file of files) {
    const mine = entryAt(cwd, tip, file), theirs = entryAt(cwd, mainline, file);
    if (mine.error || theirs.error) return false;
    if (mine.missing && theirs.missing) continue; // deleted on both sides: the same state
    if (mine.missing) return false; // the branch removes what mainline still has: a difference (fileEverMatchedMainline answers the same; said here so the rule reads in one place)
    if (mine.entry !== theirs.entry && !fileEverMatchedMainline(branch, file, mainline, cwd, trace)) return false;
  }
  return true;
}

// THE MOVED-ON HOLE, and it is the FOURTH of this exact shape in this one check.
// The comparison above asks whether the branch's copy of a file matches mainline's
// copy RIGHT NOW. So a branch that landed cleanly and was then overtaken — mainline
// changed the same file again afterwards — stops matching and reverts to being
// reported as unpushed work. Its work is on mainline; mainline has simply moved past
// it.
//
// That is the common case, not an edge one: a squash-merged branch touching a shared
// file (a registry, a figure, a generated page) is overtaken by the very next merge
// that touches it. Measured 2026-09-17: SEVEN branches, every one of them a MERGED
// pull request (#787, #790, #791, #741, #803), all reported as local work the Review
// Hub had never seen. And the remedies the message offers are wrong for the fourth
// time — pushing re-creates a dead branch, deleting is refused by this repo's own
// dangerous-command hook.
//
// So the question becomes "was this content EVER on mainline", not "is it there
// this instant". An entry that appeared in mainline's history for that path is content
// that landed, whatever happened to the file since.
//
// ...SINCE THE BRANCH FORKED, and only since. Round 5 walked mainline from its first commit, so a local-only REVERT
// (or revert of a revert) matched a blob from BEFORE the branch existed: mainline had gone v1 -> v2 -> v1, the branch
// re-applied v2, and v2's old commit "matched", clearing real work the Hub has never seen. A squash of THIS branch can
// only land after the branch forked, so the walk is mainline minus everything the BRANCH reaches (`<tip>..mainline`; round 6
// bounded it by `<merge-base>..`, which a criss-cross merge, with two merge bases, defeats). No merge base (unrelated
// histories) is no answer: false.
//
// Fail-closed, like its three siblings. Bounded to the most recent MAX_HISTORY
// commits touching the path: an unbounded walk on a long history is a check nobody
// waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared — so the failure mode of
// looking too little is a branch that stays named, never one that vanishes quietly.
function fileEverMatchedMainline(branch, file, mainline = MAINLINE, cwd = repo, trace = null) {
  if (graftsBlock(cwd)) return false;
  const git = gitIn(cwd);
  const mine = entryAt(cwd, headRef(branch), file);
  if (!mine.entry) return false;
  if (!git("merge-base", mainline, headRef(branch))) return false; // unrelated histories: no fork to bound by
  const sb = shallowBounds(cwd, headRef(branch), mainline);
  if (sb.off) return false;
  // `<tip>..mainline`, not `<merge-base>..mainline`: with TWO merge bases (a criss-cross merge) `git merge-base` names one, and the other
  // side's pre-fork commits stay in the walk, so a change mainline made and reverted BEFORE the fork matched a local re-apply of it
  // (round-6 refute C1, both merge orders). Everything reachable from the branch is by definition not a post-fork landing of it.
  // ...minus what a shallow boundary on the branch's own side HIDES from "reachable from the branch" (sb.exclude: the real parents of every
  // boundary commit under the tip, see shallowBounds).
  const hist = git("--literal-pathspecs", "log", `--max-count=${MAX_HISTORY}`, "--format=%H", mainline, `^${headRef(branch)}`, ...sb.exclude.map((p) => `^${p}`), "--", file);
  if (!hist) return false;
  for (const commit of hist.split("\n").map((c) => c.trim()).filter(Boolean)) {
    if (entryAt(cwd, commit, file).entry === mine.entry && landsAfterCut(cwd, sb, commit, trace)) return true;
  }
  return false;
}

// THE SQUASH-OF-A-MERGE-TREE HOLE (2026-09-20), the fifth shape in this one check. The
// byte check above needs every changed file to match SOME mainline blob. A squash merge
// lands the pull request's MERGE tree, not the branch tip's tree, so a shared file that
// mainline also moved between the branch's base and the squash (docs/BUILD_BACKLOG.md, on
// both #860 and #900) lands as a three-way merge result that never equals the branch's
// blob — and the branch is reported as unpushed on every turn, forever. Measured: one file
// per branch, history depth 111, every other file matching.
//
// So the second question is about HUNKS, not blobs: does the branch's whole diff against
// its merge-base carry the same patch-id as some single-parent commit's own diff on
// mainline? A squash of a clean merge carries exactly the branch's hunks whatever mainline
// did elsewhere in the same file. Two rules keep it honest, both learned on PR #911:
//   · `--verbatim`, never `--stable`: --stable strips whitespace, so two different
//     whitespace-only edits collide and a never-landed tip would read LANDED;
//   · a patch-id match is a CANDIDATE, not a verdict: the branch's hunks re-applied to the
//     squash's parent must reproduce the squash's tree exactly, or the branch stays reported.
// Bound to the CURRENT tip by construction — a branch extended after its merge has a
// different whole-diff patch-id. And bound to the FORK: the history walked is `<merge-base>..mainline` (see
// fileEverMatchedMainline for the round-5 revert that matched a commit from before the branch existed).
// Purely local: no network, no GitHub call from a hook
// (AGENTS.md: no live API calls); confirming a landing against GitHub by hand is an
// operator step outside this path. Fail-closed like its siblings: no diff, no merge-base,
// no history, a git error, a matched id that does not re-apply — all FALSE, all reported.
function landedByPatchId(branch, mainline = MAINLINE, cwd = repo, trace = null) {
  if (graftsBlock(cwd)) return false; // see hasLandedByContent: a graft rewrites the history both diffs and the walk below read
  const git = gitIn(cwd);
  const base = git("merge-base", mainline, headRef(branch));
  const tip = git("rev-parse", "--verify", `${headRef(branch)}^{commit}`);
  if (!base || !tip || base === tip) return false;
  const sb = shallowBounds(cwd, headRef(branch), mainline);
  if (sb.off) return false;
  const patch = commitDiff(cwd, base, tip);
  if (!patch) return false;
  const want = patchIdOf(cwd, patch);
  if (!want) return false;
  // the walk ends at the BRANCH, not at one merge base, and not at a shallow cut either (fileEverMatchedMainline says why)
  const hist = git("log", `--max-count=${MAX_HISTORY}`, "--format=%H %P", mainline, `^${headRef(branch)}`, ...sb.exclude.map((p) => `^${p}`));
  if (!hist) return false;
  for (const line of hist.split("\n")) {
    const [commit, ...parents] = line.trim().split(" ");
    if (!commit || parents.length !== 1) continue; // a squash has exactly one parent
    const own = commitDiff(cwd, parents[0], commit);
    if (!own || patchIdOf(cwd, own) !== want) continue;
    return reappliesExactly(cwd, parents[0], patch, commit) && landsAfterCut(cwd, sb, commit, trace);
  }
  return false;
}
// A SHALLOW BOUNDARY on the branch's side defeats `<tip>..mainline` (round-7 refute SH1, SH3). A commit named in .git/shallow has its
// parents CUT in every walk, so the real ancestors of the tip that lie below the cut are no longer "reachable from the branch", and a
// mainline commit that really is one of them (a feature mainline made and reverted before the fork) appears in the walk as if it landed
// AFTER the fork. SH1: a hand-written .git/shallow line naming the local re-apply commit. SH3, with ordinary commands only: a full clone
// checks out a Hub PR branch, re-applies the reverted feature locally, merges another Hub branch, and a later depth-1 fetch of that PR
// branch makes the PR tip a boundary under the lane's own work. The live shared checkout IS shallow.
// shallowClosure repairs the cut: for each boundary commit reachable from a start (iterating: the real parents are walked too, and may sit
// above further boundaries) the REAL parents are read from the commit object itself (`cat-file commit` ignores the cut). A real parent that
// is in the store goes to `exclude` (to be added as `^<parent>` to both walks) and is walked on; a boundary whose real parent is NOT in
// the store is `opaque`. shallowBounds then decides, for the tip:
//   no opaque boundary under the tip                       -> exclude, nothing else;
//   every opaque boundary is also reached from mainline    -> the same: the cut is SHARED history (the ordinary shallow clone: tip and mainline are
//                                                             cut at the same depth, mainline's own cut repaired the same way, and whatever lies
//                                                             below is hidden from both walks alike);
//   an opaque boundary mainline does not reach              -> the branch's own history is unknowable here, `off` says so and every landed
//                                                             exemption for this branch is off, with the reason in the row.
// (Round 8 left a known limit here: a shared opaque boundary was trusted to hide the same history from both sides, and a mainline that reaches the
// boundary's commit by a path that avoids it still showed a pre-fork commit as post-fork. Round 9 closes it in landsAfterCut, below: a mainline commit
// counts as a landing only if it descends from every opaque boundary under the tip.)
function shallowClosure(cwd, start, shallow) {
  const exclude = new Set(), opaque = new Set(), handled = new Set(), reached = new Set();
  let frontier = [start];
  for (let round = 0; frontier.length && round < 64; round++) {
    const listed = gitRun(cwd, ["rev-list", "--stdin"], { input: `${frontier.join("\n")}\n` });
    if (!listed.ok) return { error: "the history under the shallow boundary could not be listed" };
    const next = [];
    for (const c of listed.stdout.split("\n")) {
      if (!c) continue;
      reached.add(c);
      if (!shallow.has(c) || handled.has(c)) continue;
      handled.add(c);
      const body = gitRun(cwd, ["cat-file", "commit", c]);
      if (!body.ok) return { error: `the shallow boundary commit ${c.slice(0, 12)} could not be read` };
      for (const line of body.stdout.split("\n\n")[0].split("\n")) {
        if (!line.startsWith("parent ")) continue;
        const parent = line.slice(7).trim();
        if (gitRun(cwd, ["cat-file", "-e", `${parent}^{commit}`]).ok) { exclude.add(parent); next.push(parent); } else opaque.add(c);
      }
    }
    frontier = next;
  }
  if (frontier.length) return { error: "the shallow boundaries are nested too deeply to bound" };
  return { reached, exclude: [...exclude], opaque: [...opaque] };
}
function shallowBounds(cwd, tipRef, mainline) {
  const none = { exclude: [], off: "", opaque: [] };
  const g = gitIn(cwd);
  if (g("rev-parse", "--is-shallow-repository") !== "true") return none;
  let shallow;
  try { shallow = new Set(readFileSync(resolve(cwd, g("rev-parse", "--git-path", "shallow")), "utf8").split("\n").map((l) => l.trim()).filter((l) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(l))); }
  catch { return { exclude: [], off: "the shallow file could not be read" }; }
  if (!shallow.size) return none;
  const tip = g("rev-parse", "--verify", `${tipRef}^{commit}`);
  if (!tip) return { exclude: [], off: "the branch tip could not be read" };
  const t = shallowClosure(cwd, tip, shallow);
  if (t.error) return { exclude: [], off: t.error };
  if (!t.opaque.length) return { exclude: t.exclude, off: "", opaque: [] };
  const main = g("rev-parse", "--verify", `${mainline}^{commit}`);
  const m = main ? shallowClosure(cwd, main, shallow) : { error: "mainline could not be read" };
  if (m.error) return { exclude: [], off: m.error };
  const unshared = t.opaque.find((c) => !m.reached.has(c));
  if (unshared) return { exclude: [], off: `the history below the shallow boundary ${unshared.slice(0, 12)} is not in this checkout and mainline does not reach that commit, so the branch's own ancestry cannot be bounded: ${deepenHint()}` };
  return { exclude: t.exclude, off: "", opaque: t.opaque };
}
// ROUND 9 (the shared-boundary limit, closed). Round 8 trusted a shared opaque boundary to hide the same history from both walks, and said where that
// fails: mainline can reach the boundary's commit by a path that AVOIDS it (a merge whose side parent is a commit the branch really has below
// the cut), so a pre-fork mainline commit C appears in `<tip>..mainline` as if it landed after the fork, and a local re-apply of a feature
// mainline made and reverted long ago cleared as squash-landed (round-8 refute dShallowKL: the live checkout is shallow). The walk cannot be
// repaired (the branch's real ancestors are not in the store), so the claim is narrowed instead: a mainline commit X is evidence of a LANDING only
// if it descends from EVERY opaque boundary under the tip. X is then provably newer than everything the cut hides, whatever lies below it, and a
// commit that reaches the boundary only from beside it, or not at all, is not. Descent is proved with the commits on the way re-hashed (chainIsReal),
// like every other ancestry claim here. No opaque boundary under the tip: nothing to prove. The refusal is recorded in `trace.blocked` (the
// boundary X did not descend from) so the row can say WHY a branch it used to clear is reported, and what to do (deepen the checkout).
// (a function, not a const: the self-test runs before this module body reaches a const)
function deepenHint() { return `run ${["git", "fetch", "--deepen=N", "origin"].join(" ")} (N: enough commits to reach the branch's fork point, e.g. 50), then re-run`; }
function descendsFrom(cwd, x, o) {
  if (!x || !o || x === o) return false;
  return gitRun(cwd, ["merge-base", "--is-ancestor", o, x]).ok && chainIsReal(cwd, o, [x]);
}
function landsAfterCut(cwd, sb, commit, trace) {
  const cut = (sb.opaque || []).find((o) => !descendsFrom(cwd, commit, o));
  if (!cut) return true;
  if (trace && !trace.blocked) trace.blocked = cut;
  return false;
}
// The patch between two commits, the same way for the branch and for each mainline commit it is compared with: plumbing (`diff-tree`),
// because the porcelain `git diff` reads user configuration. diff.ignoreSubmodules=all dropped a gitlink hunk from the branch's patch, so the
// branch matched a squash that never carried it (round-6 refute B2), and color.diff=always / diff.external changed the bytes patch-id reads.
// --no-renames: a rename is a delete and an add on both sides, whatever diff.renames says.
// --text: a `-diff` or `binary` attribute (a repository's .gitattributes, or .git/info/attributes) makes git print "Binary files differ" for a TEXT
// file, so a legitimate hunks-only landing had no hunks to compare and never cleared (round-7 refute, fail-closed). With --text every file is
// diffed as the text it is; two different changes to a real binary file produce different patches (they used to produce the same, equally empty
// one, and only the exact re-apply kept them apart), and the exact re-apply still decides. (`--binary` was tried: the binary patch of a squash is
// relative to ITS parent, so it never equals the branch's.)
function commitDiff(cwd, a, b) {
  return gitRaw(cwd, ["diff-tree", "-p", "--text", "-r", "--no-renames", "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-color", a, b]);
}
function patchIdOf(cwd, patch) {
  const out = gitFeed(cwd, ["patch-id", "--verbatim"], patch);
  return out ? out.split(" ")[0] : "";
}
// The exact follow-up: read the squash's parent tree into a throwaway index, apply the
// branch's patch to that index, and compare the written tree with the squash's own tree.
// The throwaway index lives in a directory of its own: a name made up of the pid and the time, created straight in the shared temp directory, is predictable, and a symlink planted there by another
// local user redirects git's index write (CodeQL js/insecure-temporary-file; the clock also has no place in a gate). mkdtemp makes the directory with mode 0700 and an unpredictable name; the
// index is a file inside it, and the finally removes that one directory (never anything else). Any failure to make it is "not cleared".
function reappliesExactly(cwd, parent, patch, commit) {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "loop-state-idx-"));
    const idx = join(dir, "index");
    const env = { GIT_INDEX_FILE: idx }; // gitRun adds the guards (replace objects off) to every one of these, apply / read-tree / write-tree included
    if (!gitRun(cwd, ["read-tree", parent], { env }).ok) return false;
    try { closeSync(openSync(idx, "r")); } catch { return false; } // the index read-tree wrote must be there; opening it is the check and the use in one
    if (!gitRun(cwd, ["apply", "--cached", "-"], { input: patch, env }).ok) return false;
    const tree = gitFeed(cwd, ["write-tree"], "", env);
    const want = gitIn(cwd)("rev-parse", `${commit}^{tree}`);
    return Boolean(tree) && tree === want;
  } catch {
    return false;
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a throwaway directory of our own */ } }
  }
}

// THE SAME-NAME HOLE (2026-09-20), the sixth. `noRemote` below drops any branch whose NAME
// exists on the Hub before the seam looks at it, and the "carrying commits" warning covers
// only agent-worktree branches with no Hub name — so a local tip one commit AHEAD of its
// same-named remote was named by nothing. Measured on the branch that carried this very
// finding (claude/landing-record-2026-09-20 at d29bf79f, one ahead of origin). The Hub's
// tip sha comes from the same ls-remote; when that object is not in the local store the
// answer is UNKNOWN and is reported as such, never counted clean and never counted as work.
//
// The tip is refs/heads/<branch>, never the bare name: a tag called X outranks the branch X in a bare
// resolution (git's "ambiguous refname" warning goes to the stderr this file swallows), and `hubSha..X`
// then compares the TAG's commit, so a tag at the Hub's own sha read an ahead branch as "same".
// Replace objects are off (gitIn), and a present grafts file makes the count untrustworthy in the same
// way, so it reads UNKNOWN with the reason (graftsBlock) rather than a number a graft could have set.
function aheadOfHub(branch, hubSha, cwd = repo) {
  const git = gitIn(cwd);
  if (!hubSha) return { state: "unknown" };
  const reason = graftsBlock(cwd); // BEFORE the object test: an unfetched Hub tip under a graft must not drop to the quiet warning (round-25 refute)
  if (reason) return { state: "unknown", reason };
  if (git("cat-file", "-t", hubSha) !== "commit") return { state: "unknown" };
  const c = commitsNotHeldBy(cwd, `refs/heads/${branch}`, [hubSha]);
  // "at or behind the Hub" is a ZERO, and a zero is earned (commitsNotHeldBy): a forged commit in the chain between the tip and the Hub's tip
  // made real unpushed work read same (round-8 refute P3). The reason makes sameNameVerdict a gated AHEAD with the count unreadable, as a grafts file does.
  if (c.unproven) return { state: "unknown", reason: c.unproven };
  if (c.count === null) return { state: "unknown" };
  return { state: c.count > 0 ? "ahead" : "same", ahead: c.count };
}
// How many commits of `tip` NONE of `nots` reaches, where a ZERO has to be earned. `rev-list --count tip ^nots` trusts every parent line it reads, and
// git does not check an object against its name, so a forged commit in the store whose parent line names the tip, placed under a commit the Hub
// really lists, hides the tip behind a Hub commit that does not hold it: the count reads 0 for real unpushed work (round-8 refute P3 for the
// same-name count, and detached HEAD work the same way). A positive count is safe whatever was forged (it gates, and a forgery only ever lowers
// it); a ZERO is accepted only when every commit on the paths from the tip up to the `nots` hashes to its own name (chainIsReal, the check the
// holders of hubTipState already pass). { count } is an integer, or null when git cannot count; { unproven } is a sentence when the count is 0 and the chain failed.
function commitsNotHeldBy(cwd, tip, nots) {
  // A grafts file rewrites the parentage this count reads, and a zero it produced would be believed (chainIsReal re-hashes only the real commits it names): the graft file is named, the count is unreadable and gates.
  const grafted = graftsBlock(cwd);
  if (grafted) return { count: null, unproven: grafted };
  const r = gitRun(cwd, ["rev-list", "--count", "--stdin"], { input: `${tip}\n${nots.map((s) => `^${s}`).join("\n")}\n` });
  const n = r.ok ? Number(r.stdout.trim()) : NaN;
  if (!Number.isInteger(n)) return { count: null };
  if (n > 0) return { count: n };
  const tipSha = gitIn(cwd)("rev-parse", "--verify", "-q", `${tip}^{commit}`);
  if (tipSha && chainIsReal(cwd, tipSha, nots)) return { count: 0 };
  return { count: null, unproven: "the commits between the branch tip and the commit that should hold it do not all hash to their names (a hand-made object in the ancestry), so \"already on the Hub\" is not believed" };
}

// A legacy .git/info/grafts file rewrites parentage exactly as a refs/replace entry does, and
// `--no-replace-objects` (or GIT_NO_REPLACE_OBJECTS) does NOT switch it off; only GIT_GRAFT_FILE=/dev/null
// does. While one is in force no ancestry answer from this checkout is trusted.
//
// WHERE git looks is git's own answer, and nobody else's: `git rev-parse --git-path info/grafts` already
// honours GIT_GRAFT_FILE (relative values included: it prints the path relative to the CALLER's directory,
// while git itself reads a relative GIT_GRAFT_FILE from the top of the worktree), and a linked worktree
// names the shared file. The script used to read process.env.GIT_GRAFT_FILE first, which is the raw value
// and wrong for a relative one asked from a subdirectory (it resolved the name against the wrong directory
// and read "no grafts" while git applied them).
//
// WHETHER git applies anything is measured against git 2.43, not assumed. Each row names the self-test case that
// builds the shape and compares graftsState with git ITSELF (rawApplied: does `git for-each-ref --contains`
// list origin/g1o as holding the unpushed tip, i.e. does git apply the graft); a row with no case id has NONE,
// and says so:
//   absent file ...................................................... (d-G2m baseline) git applies none  -> no block
//   dangling symlink ................................................. (d-G2m)  git applies none  -> no block
//   nonexistent GIT_GRAFT_FILE ....................................... (d-G2j)  git applies none  -> no block
//   0-byte file ...................................................... (d-G2f)  git applies none  -> no block ("empty")
//   a directory at the path .......................................... (d-G2g)  git applies none  -> no block
//   GIT_GRAFT_FILE='' (git-path prints "./", the cwd) ................ (d-G2i)  git applies none, even with a
//                                                                      real .git/info/grafts -> no block
//   GIT_GRAFT_FILE=/dev/null (git's documented off switch) ........... (d-G2j)  git applies none  -> no block
//   symlink to a non-empty file ...................................... (d-G2n)  git APPLIES it    -> BLOCK (stat follows the link)
//   plain graft line, ordinary file .................................. (d-G2)   git APPLIES it    -> BLOCK
//   CRLF line ending ................................................. (d-G2p)  git APPLIES it    -> BLOCK
//   comment line followed by a graft line ............................ (d-G2q)  git APPLIES it    -> BLOCK
//   GIT_GRAFT_FILE naming a file, own or another repository's ........ (d-G2e, d-G2r) git APPLIES it -> BLOCK
//   relative GIT_GRAFT_FILE asked from a subdirectory ................ (d-G2k)  git APPLIES it    -> BLOCK
//   comment-only file ................................................ (d-G2h)  git applies none from it; we do not
//   whitespace-only file ............................................. (d-G2o)  reimplement its parser, so ANY
//                                                                      non-empty regular file BLOCKS (conservative)
// Shapes with NO case: a path we cannot stat for any reason but "does not exist" (BLOCK, unreadable tightens);
// a device, fifo or socket other than /dev/null (BLOCK, cannot tell what it holds); git failing to name the
// path at all (BLOCK). They are fail-closed by construction and are not measured against git.
// Only a BLOCK has a `reason`; the no-block states carry a `note` saying what they are.
function graftsState(cwd = repo) {
  const tail = "ancestry cannot be trusted, confirmation disabled";
  const p = gitIn(cwd)("rev-parse", "--git-path", "info/grafts");
  if (!p) return { block: true, state: "unreadable", reason: `grafts path unreadable (git did not name info/grafts); ${tail}` };
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return { block: false, state: "absent", path: abs, note: `no grafts file at ${abs}` };
    return { block: true, state: "unreadable", path: abs, reason: `graft file unreadable (${e && e.code ? e.code : e}): ${abs}; ${tail}` };
  }
  if (st.isDirectory()) {
    return process.env.GIT_GRAFT_FILE === ""
      ? { block: false, state: "disabled", path: abs, note: "grafts disabled by GIT_GRAFT_FILE='' (git applies none)" }
      : { block: false, state: "directory", path: abs, note: `the grafts path is a directory (git applies none): ${abs}` };
  }
  if (st.isFile()) {
    return st.size === 0
      ? { block: false, state: "empty", path: abs, note: `the grafts file is empty (git applies none): ${abs}` }
      : { block: true, state: "present", path: abs, reason: `graft file present: ${abs}; ${tail}` };
  }
  if (abs === "/dev/null") return { block: false, state: "disabled", path: abs, note: "grafts disabled by GIT_GRAFT_FILE=/dev/null" };
  return { block: true, state: "present", path: abs, reason: `graft path is not a regular file: ${abs}; ${tail}` };
}
// "" when no grafts file is in force, else the reason, which names the file.
function graftsBlock(cwd = repo) {
  const g = graftsState(cwd);
  return g.block ? g.reason : "";
}

// THE ALIAS HOLE, and it is the third of exactly this shape. Membership was derived
// from the branch NAME appearing on the hub, so a local branch pointing at a commit
// that IS on the hub under a DIFFERENT name read as unpushed work. Subagents doing
// merge-conflict triage produce precisely that: `pr782` checked out from
// `origin/claude/build-itsm-dispatch-seam` is the same commit wearing a local name.
// Measured 2026-09-17: EIGHT branches failed this seam at once while every one of
// their commits sat on origin. And both remedies the message offers were wrong again —
// pushing would litter the shared remote with duplicate names for branches already on
// it, and deletion is refused by this repo's own dangerous-command hook.
//
// The tip being held by a Hub branch under another name IS "confirm the remote", which is the
// message's own second option. Fail-closed like its two siblings: a git error, an unreadable ref
// or an empty answer leaves the branch REPORTED, never cleared.
//
// WHAT "HELD BY THE HUB" MEANS here is the one thing hubNamesHoldingTip (below) answers, and this
// function is only its yes/no. Until round 5 this function read `git branch -r --contains` instead: the
// LOCAL refs/remotes snapshot, which is not the Hub. A grafts file, a hand-made refs/remotes/pr/999 (the
// shared checkout carries a set of refs/remotes/pr/* refs; count them with `git for-each-ref refs/remotes/pr/`,
// the number moves) or a stale tracking ref cleared REAL unpushed work in this gated row ("1 on the hub under
// another name") with exit 0, and the sentence that stood here, "this cannot clear real local work", was false
// on exactly those inputs. Round 5 fixed that by trusting a tracking ref only where its sha EQUALED the Hub's, and
// round 6's refuter found the price: when the Hub moved <name> FORWARD after the last fetch the holder was merely
// BEHIND, no longer equal, and a branch that IS on the Hub read "push, or confirm the remote" until a `git fetch`;
// a tip that EQUALLED a Hub-listed sha pushed by URL (so no tracking ref was ever written) never cleared at all.
//
// So the rule is ANCESTRY AGAINST THE HUB'S OWN LISTING, not a tracking ref: a branch is on the Hub under another
// name when its tip is an ancestor of (or equal to) the commit the Hub's ls-remote lists for <name>, that commit
// is in the local object store, replace objects are off and no grafts file is in force (hubTipState). A snapshot
// ref, a second remote, a replace ref, a graft and a same-named tag each fail it, and with a grafts file in force
// the row says the exemption is off and names the file. When NO listed commit is local but a tracking ref that
// holds the tip lags the Hub's sha for its name, the answer is "fetch" (hubFetchCauses), still a gated failure.
function isOnHubBySha(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd).holds;
}

// THE SAME-NAME ALIAS HOLE (2026-10-08), the alias hole's twin on the other seam. The seam
// "Local tip ahead of its same-named Hub branch" counted `hubSha..branch` and nothing else, so
// it never asked the question the sibling seam above already answers: is this tip on the Hub
// under ANOTHER ref? Measured today: claude/signalgrid-launch-plan-emxm01 sits at 369913e57,
// an ancestor of origin/SignalGrid_Alpha (`git merge-base --is-ancestor` exits 0), while a stale
// same-named Hub branch from 2026-09-15 (5eb1ead40, a closed PR #531) has DIVERGED from it:
// `gh api repos/DanFashauer/SignalGrid-Review-Hub/compare/5eb1ead40...369913e57` reads
// ahead_by 2611, behind_by 35, merge base 9ee581eb (2026-09-15T00:19:37Z). The "+50" the seam
// printed is the shallow clone's depth (rev-list counts only back to the shallow boundary), not
// the divergence. The seam reported "+50" and BOTH remedies it offers were wrong: the push is a
// non-fast-forward (refused without force, and force is forbidden here) and "confirm the remote"
// was already true, just unread. A session cannot clear that, so it learns to narrate past it.
//
// The rule is the one stated above isOnHubBySha, and since round 5 BOTH seams call the same function
// (hubTipState) for it. For two rounds they did not: this seam was Hub-anchored and the sibling
// read the LOCAL refs/remotes snapshot, and a snapshot is not the Hub. A first version of this
// function trusted `git branch -r --contains` and an Opus refuter overturned it with four
// fixtures, each reading "confirmed" for a tip that is on the Hub nowhere: (F1) the Hub rewound
// the same-named branch while local origin/X still sat at the old tip; (F2) a tracking ref for a
// branch the Hub has since deleted (no fetch.prune); (F3) a second remote (fork/X); (F4) a
// hand-written refs/remotes/pr/999. Round 4's refuter then found the same four holes, unchanged, in the
// sibling (isOnHubBySha), whose row is gated.
//
// So the confirmation is ANCHORED TO THE LS-REMOTE the seam already took: the only commits asked about
// are the shas the Hub's own listing gives (hubShaMap), under a name that is not this branch. A stale origin/X
// (F1), a pruned-late origin/Z the Hub no longer lists (F2), any other remote (F3) and a hand-made ref outside
// origin or at a sha the Hub does not list (F4) are never asked about at all. (Rounds 3-5 asked about the LOCAL
// origin/<name> refs and required each to sit AT the Hub's sha; round 6 asks about the Hub's shas themselves, by
// ancestry, so a holder the Hub has since moved forward still counts: see isOnHubBySha.)
//
// Anchoring is necessary and NOT sufficient. It proves the sha is the Hub's; it does not prove the LOCAL graph
// answers "does that commit descend from my tip" the way the Hub's would, because three pieces of hand-made
// local state rewrite the graph or the name it is asked about. A second Opus refute (round 2) read each of
// them "confirmed" for work the Hub's object store does not hold:
//   G1  `git replace --graft <Hub sha of other> <T>` (refs/replace/*) gives origin/other, whose
//       local sha equals the Hub's, a parent of T, so --contains lists it;
//   G2  a legacy .git/info/grafts line does the same, and replace-objects-off does not disable it;
//   G3  a local TAG named like the branch shadows it: a bare `X^{commit}` resolves refs/tags/X, so
//       the verdict is computed on the tag's commit, not the branch's tip (real unpushed work on
//       refs/heads/X read confirmed, +1 instead of +2).
//
// What holds now: confirmation is anchored to the Hub's sha AND reads ancestry with replace objects
// off and no commit-graph (gitRun sets both for EVERY git this file starts); a grafts file, which
// replace-objects-off does not cover, disables confirmation outright (graftsBlock), and the verdict
// then reads AHEAD with the count unreadable and the reason naming the file; and the branch tip is always
// refs/heads/<branch>, never the bare name (here, in aheadOfHub, and in every other git
// argument that names a local branch: hasLandedByContent, fileEverMatchedMainline, landedByPatchId,
// newerCommitCount and the carrying count; the list itself is full refnames, see listLocalBranches).
//
// WHAT IS TRUSTED, NOT VERIFIED (the known limit, round-6 refute A9): git does not check an object against its name when it
// READS it, so an object in the local store is believed to be the object its sha says. The commits the Hub LISTS are re-hashed
// (localCommits), so a hand-written loose object planted at a Hub-listed sha holds nothing. The history BELOW a listed commit is
// not re-hashed: a forged ancestor still reads as the real one, and so does the claim that the Hub holds the whole history of
// a commit it lists. Planting either needs write access to .git, which already decides the verdicts of every gate that reads this
// checkout; the guard is against a planted LISTED commit, the one forgery that is a single file. The seam REPORTS a confirmed branch by
// name so the exclusion is visible, never silent. Fail-closed exactly like the alias check: a git
// error, an unreadable ref, an empty answer, a missing map or a grafts file leaves the branch
// AHEAD; an unknown Hub sha stays UNKNOWN (containment is only asked of a branch already proven
// ahead, never used to clear an unreadable comparison); and a branch with a commit no Hub ref
// holds is contained in none, so renaming cannot clear real local work.
function hubNamesHoldingTip(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd, { names: true }).holders;
}
// The remedy for a branch the Hub may well hold but this checkout cannot see yet: a gated failure all the same,
// worded so the next step is the right one. hubFetchCauses answers WHICH tracking ref lags; the strings are shared
// by every row that says it, so one cause reads one way everywhere.
function hubFetchCauses(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd).behind;
}
// (function declarations, not consts: the self-test runs before this module body reaches a const)
function fetchHint(name) { return `origin/${name} is behind the Hub: run git fetch origin, then re-run`; }
function unfetchedHint(name) { return `the Hub's ${name} is not fetched here: run git fetch origin, then re-run`; }

// The shas among `shas` that are COMMITS in this checkout's object store AND hash to their own name: one process (`cat-file --batch`), the
// body of each commit re-hashed here. Git does not verify an object when it READS it, so a hand-written loose object at a Hub-listed
// sha (content that does not hash to its name) was believed, and its forged parent line made any tip look held by the Hub (round-6
// refute A9). What is NOT re-hashed is the history BELOW a listed commit: an ancestor forged the same way would still be believed. That
// is the trusted-not-verified limit (content addressing is assumed for everything but the commits the Hub names). An unreadable answer
// is the empty set, which can only withhold a confirmation, never grant one. Only full-length lowercase hex is asked about: an
// abbreviation, a tag or a revision expression must not resolve to a commit the Hub never listed.
function localCommits(cwd, shas) {
  const want = [...new Set(shas)].filter((s) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s));
  const found = new Set();
  if (!want.length) return found;
  const r = gitRun(cwd, ["cat-file", "--batch"], { input: `${want.join("\n")}\n`, buffer: true });
  if (!r.ok) return found;
  const buf = r.stdout;
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const head = buf.toString("utf8", pos, nl).split(" ");
    pos = nl + 1;
    if (head.length !== 3 || head[1] === "missing") continue;
    const size = Number(head[2]);
    if (!Number.isInteger(size) || pos + size > buf.length) break;
    const body = buf.subarray(pos, pos + size);
    pos += size + 1;
    if (head[1] !== "commit") continue;
    const digest = createHash(head[0].length === 64 ? "sha256" : "sha1").update(Buffer.concat([Buffer.from(`commit ${size}\0`), body])).digest("hex");
    if (digest === head[0]) found.add(head[0]);
  }
  return found;
}

// Is the tip an ancestor of (or equal to) AT LEAST ONE of these commits? ONE process: `rev-list <tip> --not <every sha>` prints
// the tip exactly when none of them reaches it, so empty output is "yes". true | false | null (git could not answer: a listed
// commit with a broken history, say; the caller then asks each commit alone, and an unanswered question never grants). Asked of
// each listed commit in turn this cost ~35 ms a sha on the shared checkout (211 Hub branches: 4-7 s for ONE unpushed branch,
// measured 2026-10-08, which doubled the whole check); asked once it is ~30 ms. Replace objects are off; the grafts guard is the caller's.
//
// A "yes" is then CHECKED: the commits on the paths from the tip up to the holders (`rev-list --ancestry-path ^tip <holders>`) are re-hashed
// (chainIsReal). Round 7 re-hashed only the commits the Hub LISTS, so the real Hub commit planted over a FORGED parent whose content names
// the tip read held (round-7 refute OBb); every link of the chain the answer rests on is now verified, not only its end.
function tipReachableFromAny(cwd, tip, shas) {
  if (!shas.length) return false;
  if (graftsBlock(cwd)) return null; // unknown, never a yes or a no a graft could have set
  const r = gitRun(cwd, ["rev-list", "--stdin", "--max-count=1"], { input: `${tip}\n${shas.map((s) => `^${s}`).join("\n")}\n` });
  if (!r.ok) return null;
  if (r.stdout.trim() !== "") return false;
  return chainIsReal(cwd, tip, shas);
}
function chainIsReal(cwd, tip, shas) {
  if (graftsBlock(cwd)) return false;
  const p = gitRun(cwd, ["rev-list", "--ancestry-path", "--stdin"], { input: `^${tip}\n${shas.join("\n")}\n` });
  if (!p.ok) return false;
  const chain = [...new Set(p.stdout.split("\n").filter(Boolean))];
  return localCommits(cwd, chain).size === chain.length;
}

// What the Hub's own listing says about a local tip (the ancestry rule above isOnHubBySha):
//   holds    whether any Hub-listed commit (never this branch's own name) that is in the local store has the tip as an
//            ancestor, or IS the tip (`merge-base --is-ancestor T T` is true): tipReachableFromAny, one process.
//   holders  the NAMES behind that yes, one tipReachableFromAny([that commit]) per local commit (the SAME primitive as the yes/no, so
//            the two cannot disagree: round 6 asked `merge-base --is-ancestor` here, which errors on a missing parent beside the tip
//            and answered "no" where the one-process answer was a true "yes", leaving holds: true with no name; since round 8 the answer
//            also re-hashes every link of the chain, which reads every parent of a holder, so that hole fails BOTH closed); only when asked
//            for (names: true), because the seams need the yes/no and the names cost a process each (hubNamesHoldingTip, the self-test).
//   behind   only when there is NO holder: [{ name, local, hub }] for each tracking ref origin/<name> that holds the
//            tip while the Hub lists <name> at a DIFFERENT sha whose object this checkout does not have. The holder is
//            behind the Hub (or the Hub moved it sideways), the tip may be on the Hub, and only a fetch tells which.
//            A Hub sha that IS local and does not have the tip is no such cause: that is a rewind, and fetching changes nothing.
// `name === branch` is skipped because "under ANOTHER name" is what the callers ask. Neither caller can reach it with
// a holder (the unpushed seam only asks about names the Hub lacks; the same-name seam only after hubSha..tip > 0, which
// means the tip is not an ancestor of the Hub's own sha for that name), so it is a defensive equivalent and no case
// claims to test it. A Hub branch literally named HEAD is a real branch here (the map comes from ls-remote --heads).
function hubTipState(branch, hubShaMap, cwd = repo, { names = false } = {}) {
  const none = { holds: false, holders: [], behind: [] };
  if (!(hubShaMap instanceof Map)) return none;
  if (graftsBlock(cwd)) return none; // a grafts file can fake the very ancestry asked below
  const git = gitIn(cwd);
  const tip = git("rev-parse", "--verify", `refs/heads/${branch}^{commit}`); // the BRANCH, never a same-named tag
  if (!tip) return none;
  const listed = [...hubShaMap].filter(([name, sha]) => name !== branch && typeof sha === "string" && sha);
  const local = localCommits(cwd, listed.map(([, sha]) => sha));
  const present = listed.filter(([, sha]) => local.has(sha));
  const reach = tipReachableFromAny(cwd, tip, present.map(([, sha]) => sha));
  const holders = [];
  // names wanted, or the one-process answer unavailable (null): ask each local commit alone
  if (names || reach === null) {
    for (const [name, sha] of present) {
      if (tipReachableFromAny(cwd, tip, [sha]) === true) {
        holders.push(name);
        if (!names) break; // only the unknown yes/no is being settled: one holder answers it
      }
    }
  }
  const holds = reach === null ? holders.length > 0 : reach;
  if (holds) return { holds: true, holders, behind: [] };
  return { holds: false, holders: [], behind: behindCauses(cwd, tip, hubShaMap, local, branch) };
}
// The tracking refs origin/<name> that hold `tip` while the Hub lists <name> at a DIFFERENT sha this checkout does not have (`local`: the listed
// commits that are in the store): a fetch settles whether the Hub holds the tip, so the remedy is a fetch. Remedy evidence only, never a clearing one.
function behindCauses(cwd, tip, hubShaMap, local, branch) {
  const behind = [];
  const rows = gitIn(cwd)("for-each-ref", "--contains", tip, "--format=%(refname:lstrip=3) %(objectname)", "refs/remotes/origin");
  for (const line of rows ? rows.split("\n") : []) {
    const i = line.lastIndexOf(" ");
    if (i < 1) continue;
    const name = line.slice(0, i), have = line.slice(i + 1), hub = hubShaMap.get(name);
    if (name === branch || name === "HEAD") continue; // origin/HEAD is a symref to a branch, not a Hub branch of its own
    if (!hub || hub === have || local.has(hub)) continue;
    behind.push({ name, local: have, hub });
  }
  return behind;
}
function sameNameVerdict(branch, hubSha, hubShaMap, cwd = repo) {
  const r = aheadOfHub(branch, hubSha, cwd);
  // A grafts file: aheadOfHub cannot read the count, and "same" or "confirmed" would both be answers a
  // graft could have set. It stays a gated AHEAD (count unreadable) naming the file, never the
  // non-gated "unknown" warning: planting a file must not turn a failing row into a quiet one.
  if (r.reason) return { state: "ahead", ahead: null, reason: r.reason };
  if (r.state === "unknown") return unknownSameName(branch, hubSha, hubShaMap, cwd);
  if (r.state !== "ahead") return r;
  const s = hubTipState(branch, hubShaMap, cwd);
  if (s.holds) return { state: "confirmed", ahead: r.ahead };
  return s.behind.length ? { ...r, fetch: fetchHint(s.behind[0].name) } : r;
}
// The Hub's tip for this branch's own name cannot be compared: it is not in the local store (the Hub moved the name since the last fetch),
// or the map has no sha for the name at all. "Cannot tell ahead from behind" is the right answer for a branch that is only BEHIND, and a
// non-gated warning with a fetch remedy is the right row. It is the WRONG one for a branch carrying a commit of its own: round 6 gave a
// same-named branch with real local-only work, after another lane pushed to the same name, only that warning, and the gated row read ok
// (refute dU). So when origin/<name> exists, the local commits beyond it are counted (that needs no Hub object), and any beyond it that
// no Hub-listed commit holds are a gated AHEAD, with the fetch remedy first since a fetch is what settles whether the Hub already has
// them (when one does hold them they stay under the warning: nothing to gate, nothing counted clean). A count git cannot give is unreadable, and unreadable gates too. (Round 16: the count is against the Hub's
// listed commits alone, with or without an origin/<name>; see unknownSameName.) A Hub sha that IS local and still unreadable gets no fetch hint.
function unknownSameName(branch, hubSha, hubShaMap, cwd) {
  const git = gitIn(cwd);
  if (hubSha && git("cat-file", "-t", hubSha) === "commit") return { state: "unknown" };
  const tracked = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}^{commit}`);
  const fetch = !hubSha ? "" : tracked ? fetchHint(branch) : unfetchedHint(branch);
  const noSha = hubSha ? {} : { reason: `the Hub sha map has no sha for ${branch}` };
  // With NO origin/<name> the count is made against the Hub-listed commits alone (round-7 refute SNb: a single-branch clone, whose refspec
  // is +refs/heads/main only, never gets origin/feat from a push; the early "unknown" for a missing tracking ref was a gate that needed the
  // very ref a single-branch clone does not have).
  // ...and also WITH one (wave-78 review, p2b): a hand-made refs/remotes/origin/<own name> at the tip turned the gated ahead into the ungated warning, and a tracking ref is a name anyone can write, the
  // branch's own included. So the count is always made against the commits the Hub LISTS that this checkout has (re-hashed); a branch that is genuinely only BEHIND the Hub stays under the warning as
  // long as some listed commit holds its commits, and says fetch when none does.
  const label = "the Hub's listed commits";
  const why = {};
  const counted = commitsBeyondHub(cwd, branch, hubShaMap, "", why);
  const beyond = Number(counted);
  if (counted === "" || !Number.isInteger(beyond)) return { state: "ahead", ahead: null, beyond: label, ...(fetch ? { fetch } : {}), ...noSha, reason: `commits beyond ${label} could not be counted${why.unproven ? ` (${why.unproven})` : ""}` };
  if (beyond === 0) return { state: "unknown", ...(fetch ? { fetch } : {}), ...noSha };
  // held by a commit the Hub LISTS: the work is on the Hub, so nothing is gated; the comparison is still unreadable, so it stays the warning
  // (containment never turns an unreadable comparison into a clean one; the d-alias-unknown case). Only commits no such evidence covers gate.
  // ONLY the Hub's own listing can downgrade a gate (round-11 refute): a hand-made refs/remotes/origin/<other> at the tip made `st.behind` non-empty and turned a gated ahead into an ungated warning. The
  // branch's own origin/<name> already counted above (the commits beyond it), and any other tracking ref is a name anyone can write.
  const st = hubTipState(branch, hubShaMap, cwd);
  if (st.holds) return { state: "unknown", ...(fetch ? { fetch } : {}), ...noSha };
  return { state: "ahead", ahead: beyond, beyond: label, ...(fetch ? { fetch } : {}), ...noSha };
}
// How many commits of the branch the Hub is not KNOWN to hold: reachable from the tip and from no commit the Hub LISTS that is in the store and hashes to its name (and, when a caller passes one, from
// that tracking ref; unknownSameName no longer does: since round 16 no tracking ref is evidence). Round 7 counted against origin/<name> alone, so commits the Hub already holds under another listed name
// inflated the count. A lagging tracking ref holding the tip's older commits only over-counts, which gates, with the fetch remedy. "" when git cannot count.
function commitsBeyondHub(cwd, branch, hubShaMap, trackingRef, why = {}) {
  const listed = hubShaMap instanceof Map ? [...localCommits(cwd, [...hubShaMap.values()].filter((s) => typeof s === "string"))] : [];
  const nots = [...(trackingRef ? [trackingRef] : []), ...listed];
  const c = commitsNotHeldBy(cwd, headRef(branch), nots);
  if (c.unproven) why.unproven = c.unproven; // "" is "cannot count" to the caller, which gates; this says why
  return c.count === null ? "" : String(c.count);
}
// A DETACHED HEAD carries work no branch row can name (round-7 refute SNc): the branch list is the list of refs/heads, and commits made on
// a detached HEAD are in none of them, so a session that ended there read "all present on the Review Hub". Gated when HEAD is detached and
// has commits that no local branch, no remote-tracking ref and no Hub-listed commit holds (an uncountable answer gates too).
//
// WHAT HOLDS A COMMIT (round 9; round 8 counted against every ref under refs/heads AND refs/remotes). A remote-tracking ref is a snapshot anyone can
// write: `git update-ref refs/remotes/evil/x HEAD`, or refs/remotes/origin/pr/999 (the shared checkout really carries a set of refs/remotes/pr/*
// refs), made detached work read "all present on the Review Hub". Evidence is now only what the other rows already trust: a LOCAL BRANCH (its own
// row decides whether that is on the Hub) and a commit the Hub LISTS (re-hashed by localCommits), never a tag and never a tracking ref. A zero is earned
// (commitsNotHeldBy: the chain between HEAD and the commit that holds it is re-hashed). A HEAD that a tracking ref holds while the Hub lists that
// name at a sha this checkout lacks is the stale-fetch case: the row says run a fetch (behindCauses), it does not stop gating.
function detachedHeadWork(cwd, hubShaMap) {
  const sym = gitRun(cwd, ["symbolic-ref", "-q", "HEAD"]);
  if (sym.ok) return null;
  // `symbolic-ref -q` exits 1 for a detached HEAD and anything else for a git that FAILED; a HEAD that cannot be named is not "no detached work" (round-25 refute: a failing git turned this gated row into silence)
  if (sym.status !== 1) return { head: null, count: null, unreadable: String(sym.stderr).split("\n").find(Boolean) || `exit ${sym.status}` };
  const headR = gitRun(cwd, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  const head = headR.ok ? headR.stdout.trim() : "";
  if (!head) return { head: null, count: null, unreadable: String(headR.stderr).split("\n").find(Boolean) || `HEAD does not name a commit (exit ${headR.status})` };
  const refs = gitIn(cwd)("for-each-ref", "--format=%(objectname)", "refs/heads");
  const listed = hubShaMap instanceof Map ? [...localCommits(cwd, [...hubShaMap.values()].filter((s) => typeof s === "string"))] : [];
  const nots = [...new Set([...(refs ? refs.split("\n") : []), ...listed])].filter(Boolean);
  const c = commitsNotHeldBy(cwd, head, nots);
  if (c.count === 0) return null;
  const behind = hubShaMap instanceof Map ? behindCauses(cwd, head, hubShaMap, new Set(listed), "") : [];
  return { head, count: c.count, ...(c.unproven ? { unproven: c.unproven } : {}), ...(behind.length ? { fetch: fetchHint(behind[0].name) } : {}) };
}
// "a, b — <remedy>; c — <remedy>": the branches grouped by the remedy each needs, so one cause reads one way everywhere.
// pairs: [[branch, remedy or ""]]; the ones with no remedy of their own go first under `plainRemedy`.
function remedyGroups(pairs, plainRemedy) {
  const by = new Map(), plain = [];
  for (const [b, remedy] of pairs) {
    if (!remedy) { plain.push(b); continue; }
    if (!by.has(remedy)) by.set(remedy, []);
    by.get(remedy).push(b);
  }
  return [...(plain.length ? [`${plain.join(", ")} — ${plainRemedy}`] : []), ...[...by].map(([remedy, bs]) => `${bs.join(", ")} — ${remedy}`)].join("; ");
}

// The row the seam prints for the same-named comparison, pure so the self-test can call it: a
// confirmed branch is named in the detail (never swallowed), and the ok row's title says what it
// now covers. verdicts: [{ branch, state, ahead }] as sameNameVerdict returns, plus the name.
function sameNameRows(verdicts) {
  const ahead = verdicts.filter((v) => v.state === "ahead").map((v) => `${v.branch} (${Number.isFinite(v.ahead) ? `+${v.ahead}${v.beyond ? ` beyond ${v.beyond}` : ""}` : "count unreadable"})`);
  const why = [...new Set(verdicts.filter((v) => v.reason).map((v) => v.reason))].map((r) => ` (${r})`).join("");
  const confirmed = verdicts.filter((v) => v.state === "confirmed").map((v) => v.branch);
  const unknown = verdicts.filter((v) => v.state === "unknown").length;
  const note = confirmed.length
    ? ` (${confirmed.length} same-named branch(es) ahead of the Hub's same name but confirmed on the Hub under another branch: ${confirmed.join(", ")})`
    : "";
  // An ahead branch whose tip may be held by a tracking ref the Hub has moved on from: a fetch comes BEFORE any push.
  const fetchFirst = verdicts.filter((v) => v.state === "ahead" && v.fetch).map((v) => `${v.branch}: ${v.fetch}`);
  const fetchNote = fetchFirst.length ? ` (${fetchFirst.join("; ")})` : "";
  if (ahead.length) {
    return { level: "fail", title: "Local tip ahead of its same-named Hub branch", detail: `${ahead.join(", ")} — push, or confirm the remote; a name on the Hub is not the tip on the Hub${note}${why}${fetchNote}` };
  }
  return {
    level: "ok",
    title: "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch",
    detail: `${verdicts.length - unknown} branch(es) compared by sha${note}`,
  };
}

// ── Declared scratch branches ───────────────────────────────────────────────

// Pure parse + validate. Every entry needs name/reason/origin/declaredAt/declaredBy; names are
// exact (no wildcard, regex or glob characters); declaredAt must parse. Anything else invalidates
// the WHOLE file — an invalid allowlist never widens.
function validateScratchDeclaration(text) {
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return { ok: false, error: "not valid JSON" }; }
  if (!Array.isArray(arr)) return { ok: false, error: "top level is not an array" };
  const seen = new Set();
  for (const [i, e] of arr.entries()) {
    if (!e || typeof e !== "object") return { ok: false, error: `entry ${i} is not an object` };
    for (const k of ["name", "reason", "origin", "declaredAt", "declaredBy", "tip"]) {
      if (typeof e[k] !== "string" || !e[k].trim()) return { ok: false, error: `entry ${i} (${e.name ?? "?"}) is missing ${k}` };
    }
    if (!/^[A-Za-z0-9._\/-]+$/.test(e.name)) return { ok: false, error: `entry ${i} name "${e.name}" is not a plain branch name (wildcards/regex refused)` };
    if (!/^[0-9a-f]{40}$/.test(e.tip)) return { ok: false, error: `entry ${i} (${e.name}) tip is not a full 40-char commit sha` };
    if (!Number.isFinite(Date.parse(e.declaredAt))) return { ok: false, error: `entry ${i} (${e.name}) declaredAt does not parse` };
    if (seen.has(e.name)) return { ok: false, error: `duplicate name ${e.name}` };
    seen.add(e.name);
  }
  return { ok: true, entries: arr };
}

// The declaration is read from MAINLINE, never the working tree: a branch cannot declare itself
// scratch by editing the file it is checked out with. null = absent or unreadable on mainline,
// which means nothing is declared (git cannot tell the two apart, and both tighten the answer).
function readMainlineDeclaration(mainline, cwd) {
  const r = gitRun(cwd, ["show", `${mainline}:${SCRATCH_FILE}`]);
  return r.ok ? r.stdout : null;
}

// The local tip of exactly refs/heads/<name>; null when git cannot resolve it.
function localTip(name, cwd) {
  const r = gitRun(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${name}^{commit}`]);
  return (r.ok && r.stdout.trim()) || null;
}

// Commits on `branch` not on mainline whose committer time is after declaredAt. null = git could
// not answer, which the caller treats as "new work" (fail-closed). Committer time comes from git,
// declaredAt from the file: no clock is read.
function newerCommitCount(branch, declaredAt, mainline, cwd) {
  // refs/heads/<branch>, never the bare name (a same-named tag would win), and replace objects off like every spawn here.
  const r = gitRun(cwd, ["log", "--format=%ct", `${mainline}..${headRef(branch)}`]);
  if (!r.ok) return null;
  const at = Date.parse(declaredAt) / 1000;
  if (!Number.isFinite(at)) return null;
  // An unparseable commit time counts as newer: unknown tightens the answer.
  return r.stdout.split("\n").filter(Boolean).filter((t) => !(Number.isFinite(Number(t)) && Number(t) <= at)).length;
}

// Pure: which declared names are excluded, which are reopened, which are stale. A branch is
// excluded only while its local tip IS the declared tip and no commit on it postdates declaredAt;
// a name alone excludes nothing.
function classifyScratch(entries, localBranches, tipOf, newerFn) {
  const excluded = [], reopened = [], stale = [];
  for (const e of entries) {
    if (!localBranches.includes(e.name)) { stale.push(e.name); continue; }
    if (tipOf(e.name) !== e.tip) { reopened.push(e.name); continue; }
    if (newerFn(e.name, e.declaredAt) === 0) excluded.push(e.name); else reopened.push(e.name);
  }
  return { excluded, reopened, stale };
}

// The whole evaluation from git: mainline text -> validation -> classification.
function evaluateScratch(mainline, cwd, localBranches) {
  const none = { exists: false, ok: true, excluded: [], reopened: [], stale: [] };
  const text = readMainlineDeclaration(mainline, cwd);
  if (text === null) return none;
  const v = validateScratchDeclaration(text);
  if (!v.ok) return { ...none, exists: true, ok: false, error: v.error };
  return {
    ...none, exists: true,
    ...classifyScratch(v.entries, localBranches, (b) => localTip(b, cwd), (b, at) => newerCommitCount(b, at, mainline, cwd)),
  };
}

// Pure: the branches still to be reported as unpushed after every exclusion. There is no `b !== "HEAD"`
// here: `for-each-ref refs/heads/` never yields a pseudo entry (HEAD is not under refs/heads/), so a name
// "HEAD" in this list is a REAL branch, refs/heads/HEAD, made by `git update-ref`. Round 4 filtered it out
// (a leftover from `git branch`'s `(HEAD detached at ...)` line, which no listing here reads), and real
// unpushed work on it read "all present on the Review Hub", exit 0.
function unpushedCandidates(localBranches, hubBranches, ephemeral, scratchExcluded) {
  return localBranches.filter((b) => !hubBranches.includes(b) && !ephemeral.includes(b) && !scratchExcluded.includes(b));
}

function branchesInAgentWorktrees() {
  const out = git("worktree", "list", "--porcelain");
  if (!out) return [];
  const found = new Set();
  const agentPaths = [];
  let path = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
      // The Agent tool's isolated checkouts live under `.claude/worktrees/`.
      if (path.includes("/.claude/worktrees/")) agentPaths.push(path);
    } else if (line.startsWith("branch refs/heads/") && path.includes("/.claude/worktrees/")) {
      found.add(line.slice("branch refs/heads/".length));
    }
  }

  // The checked-out branch is only the one an agent is on RIGHT NOW. An agent that
  // builds several branches — three successive attack reproductions, say — leaves
  // the others behind as refs, and those escaped a location-only rule and failed
  // the seam anyway. Git keeps a PER-WORKTREE HEAD reflog, so every branch a given
  // worktree ever checked out is recoverable from it. That is the full set an agent
  // created, not just its current one.
  for (const p of agentPaths) {
    const log = git("-C", p, "reflog", "show", "--format=%gs", "HEAD");
    if (!log) continue;
    for (const line of log.split("\n")) {
      const m = /^checkout: moving from (\S+) to (\S+)$/.exec(line.trim());
      if (m) { found.add(m[1]); found.add(m[2]); }
    }
  }
  return [...found];
}

// The seam rows for the local branches, from a listing, the Hub's branch map and the exclusions already decided.
// A FUNCTION, not inline, so the self-test runs the very code the live script runs, on the listing the live
// script produces (listLocalBranches), with tags, same-named refs and broken refs in the fixture. Every
// branch is a SHORT name here (the string after refs/heads/, the same key the Hub map uses) and is
// qualified with headRef() at each git call below and in the functions it calls.
function branchSeamRows({ listing, hubBranches, hubShaMap, ephemeral, scratchExcluded, mainline = MAINLINE, cwd = repo, anchor = null }) {
  if (!listing.ok) return [branchListRow(listing)];
  const localBranches = listing.names;
  const git = gitIn(cwd);
  const rows = [];
  const row = (state, what, detail, gated = true) => rows.push({ state, what, detail, gated });
  const noRemote = unpushedCandidates(localBranches, hubBranches, ephemeral, scratchExcluded);
  // THE SQUASH-MERGE HOLE, and it is the same shape as the one above. A branch merged
  // with squash has no remote afterwards (GitHub deletes it) and is NOT an ancestor of
  // mainline, because the squash makes a new commit. So this seam reported "local work
  // not on the Review Hub" about content sitting in mainline — and both remedies it
  // offers are wrong again: pushing recreates a dead branch on the shared remote after
  // every single merge, and deletion is refused twice over, once by this repo's own
  // dangerous-command hook (which denies the force form) and once by git itself (the
  // safe form declines a branch that is not an ancestor, which a squash guarantees).
  // Measured on 2026-09-14: three merges, three false failures, each cleared only by
  // re-pushing the corpse.
  //
  // So membership is derived from CONTENT here too, not from reachability. Fail-closed
  // in every direction: one path whose tree entry (mode and object id) never appeared on mainline
  // since the branch forked, a path the branch removes that mainline still has, an unreadable diff
  // or entry, or any git error and the branch is still reported unpushed. "Real work is a difference,
  // and a difference can never pass this" was this comment's claim through round 5 and it was false:
  // the compare read trimmed TEXT through a reader that returned "" on any failure (two files over
  // 1 MiB, or two paths git could not name, both read "" and "" === "" cleared real work), and the
  // history walk began at mainline's first commit, so a local revert matched a blob from before the
  // branch existed. What is claimed now is narrower and checked: the branch's change counts as
  // landed only where a mainline commit made AFTER it forked carries the very same entry (or, in
  // landedByPatchId, the very same hunks). Content mainline carried and later removed still
  // counts as landed (that is the squash that was overtaken); a chmod-only change is a difference.
  // Three independent ways a branch is already safe, each REPORTED by name so the
  // exclusion is visible rather than silent: its commit is on the hub under another
  // name, or its content is in mainline (squash), or neither — and then it is work.
  // A grafts file switches ALL THREE exemptions off, not only the alias one: it rewrites the history the alias ancestry, the byte check's
  // path list and fork walk, and the hunk check's walk all read, and round 6 left the two landed ones running under it (a graft line
  // `S1 Q` splicing a local copy of the work into mainline's history cleared it as squash-landed while the row printed "graft file
  // present", refute GL2). Each of the three functions turns itself off (graftsBlock), so a direct caller is covered too; this row
  // only says so, in graftsNote below.
  const graftsReason = noRemote.length ? graftsBlock(cwd) : "";
  const onHub = noRemote.filter((b) => isOnHubBySha(b, hubShaMap, cwd));
  const offHub = noRemote.filter((b) => !onHub.includes(b));
  const traces = new Map(offHub.map((b) => [b, { blocked: "" }]));
  // Both landed exemptions read "mainline" from a LOCAL ref, so they run only while it is anchored to the Hub's own listing (mainlineAnchor); otherwise they are off and the row says why.
  const mlAnchor = offHub.length ? (anchor || mainlineAnchor(cwd, hubShaMap, mainline)) : { ok: true, reason: "" };
  const landedByBytes = mlAnchor.ok ? offHub.filter((b) => hasLandedByContent(b, mainline, cwd, traces.get(b))) : [];
  const landedByHunks = mlAnchor.ok ? offHub.filter((b) => !landedByBytes.includes(b) && landedByPatchId(b, mainline, cwd, traces.get(b))) : [];
  const landed = [...landedByBytes, ...landedByHunks];
  const unpushed = offHub.filter((b) => !landed.includes(b));
  const ephemeralNote = ephemeral.length ? ` (${ephemeral.length} ephemeral agent-worktree branch(es) not counted)` : "";
  const onHubNote = onHub.length ? ` (${onHub.length} on the hub under another name: ${onHub.join(", ")})` : "";
  // ...and a row that silently stopped clearing aliases and squash-landed branches would look like the branches themselves had changed.
  // So it says why.
  const graftsNote = graftsReason ? ` (alias and squash-landed exemptions OFF: ${graftsReason})` : "";
  const anchorNote = !mlAnchor.ok ? ` (squash-landed exemptions OFF: ${mlAnchor.reason})` : "";
  // ...and the same for a shallow boundary that hides a branch's own history (shallowBounds): named per branch, only for the ones still reported.
  // (a landing refused because the mainline commit does not descend from the cut is named too: landsAfterCut)
  const cutWhy = (b) => { const c = traces.get(b) && traces.get(b).blocked; return c ? `a mainline commit carries this work but does not descend from the shallow boundary ${c.slice(0, 12)} under the branch, so it may be older than the branch: ${deepenHint()}` : ""; };
  const shallowOff = unpushed.map((b) => [b, shallowBounds(cwd, headRef(b), mainline).off || cutWhy(b)]).filter(([, why]) => why);
  const shallowNote = shallowOff.length ? ` (squash-landed exemptions OFF for ${shallowOff.map(([b, why]) => `${b}: ${why}`).join("; ")})` : "";
  // A warning git printed while listing the refs that is NOT a ref-skip one (see listLocalBranches) did not change the
  // verdict, and it is named here so nothing git said is thrown away: the first three, then a count.
  const warns = listing.warnings || [];
  const warnNote = warns.length ? ` (git warned while listing branches, verdict unaffected: ${warns.slice(0, 3).join(" | ")}${warns.length > 3 ? ` | +${warns.length - 3} more` : ""})` : "";
  const landedNote =
    (landedByBytes.length ? ` (${landedByBytes.length} squash-landed, every file byte-identical to a mainline blob: ${landedByBytes.join(", ")})` : "") +
    (landedByHunks.length ? ` (${landedByHunks.length} squash-landed, exact hunks found in a mainline squash: ${landedByHunks.join(", ")})` : "");
  if (unpushed.length) {
    // A branch the Hub may hold under a name this checkout has not caught up with is still a gated failure, and its
    // remedy is a fetch, not a push (hubFetchCauses). Grouped by remedy so one cause reads one way.
    const remedyOf = (b) => { const c = hubFetchCauses(b, hubShaMap, cwd); return c.length ? fetchHint(c[0].name) : ""; };
    const groups = remedyGroups(unpushed.map((b) => [b, remedyOf(b)]), "push, or confirm the remote");
    row("fail", "Local work not on the Review Hub", `${groups}${ephemeralNote}${onHubNote}${landedNote}${graftsNote}${anchorNote}${shallowNote}${warnNote}`);
  } else {
    row("ok", "Local branches all present on the Review Hub", `${localBranches.length - ephemeral.length} branch(es)${ephemeralNote}${onHubNote}${landedNote}${graftsNote}${warnNote}`);
  }

  // A branch whose NAME is on the Hub is not thereby ON the Hub: the local tip may be ahead.
  // (No `b !== "HEAD"`: see unpushedCandidates. A real refs/heads/HEAD with a Hub branch of that name is compared like any other.)
  const sameNamed = localBranches.filter((b) => hubBranches.includes(b) && !ephemeral.includes(b));
  // No Hub sha map is no Hub: every same-named branch is then an unanswerable comparison, reported as the gated AHEAD it must be
  // (count unreadable, the cause named) rather than a TypeError on `.get` that takes the whole check down with it. The cause says WHAT
  // arrived instead of a Map: nothing, an empty `{}`, or an object that is not a Map (a plain object cannot be read with .get).
  const mapOk = hubShaMap instanceof Map;
  const mapCause = hubShaMap == null ? "no Hub sha map was passed"
    : typeof hubShaMap === "object" && Object.keys(hubShaMap).length === 0 ? "an empty Hub sha map was passed"
    : "the Hub sha map is not a Map";
  const verdicts = sameNamed.map((b) => mapOk
    ? { branch: b, ...sameNameVerdict(b, hubShaMap.get(b), hubShaMap, cwd) }
    : { branch: b, state: "ahead", ahead: null, reason: `${mapCause} — the same-name comparison did not run` });
  const unknownV = verdicts.filter((v) => v.state === "unknown");
  const sameRow = sameNameRows(verdicts);
  row(sameRow.level, sameRow.title, sameRow.detail);
  if (unknownV.length) {
    // The same cause as the unpushed row's (a tracking ref behind the Hub) reads the same way: fetchHint / unfetchedHint.
    row("warn", "Same-named branches whose Hub tip is not fetched locally",
      remedyGroups(unknownV.map((v) => [v.branch, v.fetch || v.reason || ""]), "cannot tell ahead from behind; reported, not counted clean"), false);
  }
  const dh = detachedHeadWork(cwd, hubShaMap);
  if (dh) {
    row("fail", "Detached HEAD work not on the Review Hub",
      dh.unreadable !== undefined ? `HEAD is detached and unreadable: ${dh.unreadable} — what it carries cannot be told, and unknown is not clean` : `HEAD (detached at ${dh.head.slice(0, 12)}) carries ${dh.count === null ? "commits that could not be counted" : `${dh.count} commit(s)`} no local branch or Hub-listed commit holds${dh.unproven ? ` (${dh.unproven})` : ""}${dh.fetch ? ` (${dh.fetch})` : ""} — make a branch and push it, or confirm it is scratch`);
  }
  // REPORTED, never fatal — the lane-message rule, for the same reason. The work is not lost (the worktree
  // belongs to a live agent, and anything real is pushed from it), but an agent branch carrying commits
  // beyond mainline is still worth a session's eyes, so it is named rather than swallowed by the exclusion above.
  const carrying = ephemeral
    .filter((b) => !hubBranches.includes(b))
    // Commits reachable from the branch and from NO origin ref at all — a truer
    // reading of "carrying work the remote does not have" than a diff against one
    // named branch, which would miscount a branch cut from a different base.
    .map((b) => ({ b, ahead: git("rev-list", "--count", headRef(b), "--not", "--remotes=origin") }))
    .filter((x) => x.ahead && x.ahead !== "0");
  if (carrying.length) {
    row(
      "warn",
      "Agent-worktree branches carrying commits",
      `${carrying.map((x) => `${x.b} (+${x.ahead})`).join(", ")} — reported, never fatal: they belong to a live agent's ` +
        `isolated checkout and are not the session's to push or delete. An attack reproduction MUST NOT be pushed.`,
      false,
    );
  }
  return rows;
}

if (hubBranches.length && listing.ok) {
  // Ephemeral by NAME (the Agent tool's own) or by LOCATION (anything checked out
  // in an agent worktree). Named in the output either way: the exclusion is
  // visible, never silent.
  const inWorktrees = branchesInAgentWorktrees();
  const ephemeral = localBranches.filter(
    (b) => b.startsWith("worktree-agent-") || inWorktrees.includes(b),
  );
  // DECLARED SCRATCH (owner-directed 2026-10-02): exact names in docs/agent/local-scratch-branches.json,
  // each with a reason. Fail-closed: an invalid file excludes nothing and fails the seam; a declared
  // branch with a commit newer than its declaredAt is work again. Reported on its own line, never silent.
  const ms = mainlineScratch(repo, hubSha, localBranches);
  const scratch = ms.scratch;
  if (ms.row) add(ms.row.state, ms.row.what, ms.row.detail, ms.row.gated);
  if (scratch.exists) {
    if (!scratch.ok) {
      add("fail", "Declared scratch branches", `${SCRATCH_FILE} on mainline is INVALID (${scratch.error}) — nothing excluded; fix the file`);
    } else {
      const bits = [`declared scratch (${scratch.excluded.length}): ${scratch.excluded.join(", ") || "none"} — not counted`];
      if (scratch.reopened.length) bits.push(`${scratch.reopened.length} declared but tip moved or carries commits newer than declaredAt, counted as work: ${scratch.reopened.join(", ")}`);
      if (scratch.stale.length) bits.push(`${scratch.stale.length} stale declaration(s), no such local branch: ${scratch.stale.join(", ")}`);
      add(scratch.reopened.length ? "warn" : "ok", "Declared scratch branches", bits.join("; "), false);
    }
  }
  for (const r of branchSeamRows({ listing, hubBranches, hubShaMap: hubSha, ephemeral, scratchExcluded: scratch.excluded, anchor: ms.anchor })) {
    add(r.state, r.what, r.detail, r.gated);
  }
}

// OUTSIDE the branch-list block, deliberately. This is a purely LOCAL check — it
// reads `git remote get-url` — and it sat inside `if (hubBranches.length)`, so the
// one condition under which a push is most likely to have gone to the wrong repo
// (the Hub listing nothing) was the condition under which nobody asked which repo
// origin points at. A push can "succeed" into the wrong repository.
{
  const o = originRow(repo);
  add(o.state, o.what, o.detail);
}

// ── 2. Uncommitted work — the other way things get lost ─────────────────────
const statusR = gitRun(repo, ["status", "--porcelain"]);
const dirty = statusR.ok ? statusR.stdout.split("\n").filter(Boolean) : [];
if (!statusR.ok) add("fail", "Working tree", `could not be read (git status failed: ${String(statusR.stderr).split("\n").find(Boolean) || `exit ${statusR.status}`}) — unknown is not clean`);
else add(dirty.length ? "warn" : "ok", "Working tree", dirty.length ? `${dirty.length} uncommitted file(s)` : "clean");

// ── 3. Is the doctrine actually live where people can see it? ───────────────
const readme = readIfPresent(resolve(repo, "README.md")) ?? "";
const retired = /Shared-Device Trust Gateway|trust fabric/i.test(readme.split("\n").slice(0, 40).join("\n"));
add(retired ? "fail" : "ok", "Public README uses current framing",
  retired ? "still opens with retired wording — Phase 0 has not landed here" : "no retired framing in the opening");
add(existsSync(resolve(repo, "docs/PURPOSE.md")) ? "ok" : "fail", "docs/PURPOSE.md present",
  existsSync(resolve(repo, "docs/PURPOSE.md")) ? "canonical doctrine on this branch" : "missing — apply Phase 0A");

// ── 4. THE NUMBER THAT MATTERS ──────────────────────────────────────────────
// Everything above is hygiene. This is the experiment.
const logPath = resolve(repo, "docs/agent/DISCOVERY_LOG.md");
const discoveryLog = readIfPresent(logPath);
if (discoveryLog !== null) {
  const log = discoveryLog;
  const m = log.match(/Conversations logged:\s*(\d+)\s*of\s*(\d+)/i);
  const c = log.match(/Commitments:\s*(\d+)/i);
  const logged = m ? Number(m[1]) : 0;
  const target = m ? Number(m[2]) : 15;
  const commits = c ? Number(c[1]) : 0;
  const startMatch = log.match(/Experiment started:\s*(\d{4}-\d{2}-\d{2})/);
  let daysMsg = "";
  if (startMatch) {
    const startMs = Date.parse(startMatch[1]);
    if (Number.isFinite(startMs)) {
      const days = Math.floor((Date.now() - startMs) / 86400000);
      daysMsg = ` · day ${days}`;
      if (days >= 7 && logged === 0) {
        add("warn", "Discovery", `day ${days}, still 0 conversations logged — an input now, not the gate (DR-033, past Customer Discovery).`, false);
      }
    } else {
      // Fail closed: an unparseable start date must surface, never silently skip
      // the discovery alarm (NaN >= 7 is false).
      add("fail", "Discovery start date", `unparseable "Experiment started" date in docs/agent/DISCOVERY_LOG.md`);
    }
  } else {
    // The line being ABSENT was the one shape with no row at all. An unparseable
    // date failed; a MISSING date produced silence — no day count, and the
    // "N days and 0 conversations" alarm structurally unable to fire, because the
    // alarm lives inside this `if`. That is the loudest row in the script switched
    // off by deleting one line of markdown, with nothing anywhere saying so. GATED,
    // like its unparseable sibling: the missing input is a repository defect a
    // session can fix, not a number a session cannot change.
    add(
      "fail",
      "Discovery start date",
      'no "Experiment started: YYYY-MM-DD" line in docs/agent/DISCOVERY_LOG.md — the days-since alarm CANNOT fire without it',
    );
  }
  add(logged >= target ? "ok" : "warn", "Discovery",
    `${logged}/${target} conversations · ${commits} commitment(s)${daysMsg} — input, not the gate (DR-033)`, false);
} else {
  add("warn", "Discovery log", "docs/agent/DISCOVERY_LOG.md not in the repo yet");
}

// ── 5. READINESS — the number that gates outreach (DR-036), derived, never typed ────────
// Three dimensions, headline = the lowest; floor 80 / target 92–95 / goal 100. REPORTED,
// not a seam: a low number closes outreach, it does not block a session from ending.
{
  const r = spawnSync(process.execPath, [resolve(repo, "scripts/check-readiness-figure.mjs"), "--json"], { cwd: repo, encoding: "utf8", env: gitEnv() });
  if (r.status !== 0) {
    add("fail", "Readiness figure", "derivation BROKEN — run node scripts/check-readiness-figure.mjs", false);
  } else {
    const j = JSON.parse(r.stdout.trim().split("\n").pop());
    add(j.headline >= j.floor ? "ok" : "warn", "Readiness (gates outreach)",
      `${j.headline}% = lowest of runbook ${j.a}% · launch-evidence ${j.b}% · end-to-end ${j.c}% — floor ${j.floor}, target ${j.target[0]}–${j.target[1]} (DR-036)`, false);
  }
}

// ── 4b. How much of the repo has actually been READ? ────────────────────────
// Whole-repo validation is not whole-repo reading. Derived live from the tree by
// the gate itself rather than restated here, so this row cannot fossilise.
// REPORTED, never a failure — an unread surface is a place to spend an hour, not
// a broken seam, and the gate that owns the number is the one that fails.
try {
  const { deriveSurfaces, auditSurfaceCoverage, coverTracked, listTracked } = await import("./check-surface-review-coverage.mjs");
  const ledger = JSON.parse(readFileSync(resolve(repo, "docs/agent/SURFACE_REVIEW_COVERAGE.json"), "utf8"));
  const tracked = listTracked(repo);
  const surfaces = deriveSurfaces(repo, tracked);
  const a = auditSurfaceCoverage(surfaces, ledger, { cover: coverTracked(surfaces, tracked) });
  add("ok", "Review coverage", `${a.readCount} of ${a.total} surfaces read, ${a.partial.length} partial, ${a.notRead.length} not read`);
} catch (e) {
  // Fail LOUD rather than skip: a silently absent row would read as "nothing to
  // report", which is the one thing this number must never be able to say.
  add("warn", "Review coverage", `could not be derived — ${e.message}`);
}

// ── 5. Are the doctrine gates still holding? ────────────────────────────────
for (const [label, script] of [
  ["Decision vocabulary", "scripts/check-decision-vocabulary.mjs"],
  ["Product framing", "scripts/check-product-framing.mjs"],
]) {
  if (!existsSync(resolve(repo, script))) { add("warn", label, "gate not on this branch"); continue; }
  try {
    execFileSync("node", [script], { cwd: repo, stdio: "ignore", env: gitEnv() });
    add("ok", label, "green");
  } catch {
    add("fail", label, `run: node ${script}`);
  }
}

// ── 5b. Is the LOOP.md STATE block keeping pace with mainline? ───────────────
// Two git dates, no wall clock (a session's clock is not the repo's): the STATE
// block's LAST TOUCHED date vs the newest commit date on origin/SignalGrid_Alpha.
// More than a week apart and the STATE block is trailing what the repo actually did
// (docs/agent/LOOP.md once carried a two-day STATE↔body contradiction). gated:false —
// a warn, not a seam. A missing line, an unparseable date, or an unfetched remote each
// produce the warn row itself; fail-closed, never a silent skip.
{
  const loopPath = resolve(repo, "docs/agent/LOOP.md");
  const loopText = readIfPresent(loopPath);
  const touched = loopText === null ? undefined : (loopText.match(/LAST TOUCHED:\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
  const newest = git("log", "-1", "--format=%cI", MAINLINE); // "" when the remote is unfetched → stateFreshness returns no-remote
  const f = stateFreshness(touched, newest);
  if (f.kind === "no-date") {
    add("warn", "LOOP STATE date", 'no "LAST TOUCHED: YYYY-MM-DD" line in docs/agent/LOOP.md — cannot tell if STATE trails mainline', false);
  } else if (f.kind === "no-remote") {
    add("warn", "LOOP STATE date", "origin/SignalGrid_Alpha not fetched — cannot compare STATE date to mainline's newest commit", false);
  } else if (f.kind === "stale") {
    add("warn", "LOOP STATE date", `STATE (${touched}) trails mainline's newest commit by ${f.days} days — update the STATE block`, false);
  } else {
    add("ok", "LOOP STATE date", `STATE (${touched}) within ${Math.max(0, f.days)} day(s) of mainline's newest commit`, false);
  }
}

// STATE freshness, pure and clock-free so the self-test is deterministic: two ISO
// date strings in, a verdict out. Past 7 days apart is stale; a non-finite touched
// or newest date is its own reported kind, never silently treated as fresh.
function stateFreshness(lastTouchedISO, newestCommitISO) {
  const touched = Date.parse(lastTouchedISO ?? "");
  const newest = Date.parse(newestCommitISO ?? "");
  if (!Number.isFinite(touched)) return { kind: "no-date" };
  if (!Number.isFinite(newest)) return { kind: "no-remote" };
  const days = Math.floor((newest - touched) / 86400000);
  return { kind: days > 7 ? "stale" : "fresh", days };
}

// ── 5c. Raised hands (DR-054) — is any blocker sitting unaddressed? ──────────
// The other half of the raise-your-hand reflex: a raised hand must be SEEN. This folds
// the monitor's count in so an open blocker is surfaced every session, never lost. gated:
// false — a blocker to address, not a code defect that should block a push.
{
  try {
    const out = execFileSync("node", [resolve(repo, "scripts/check-raised-hands.mjs"), "--json"], { cwd: repo, encoding: "utf8", env: gitEnv() });
    const s = JSON.parse(out);
    if (s.open === 0) {
      add("ok", "Raised hands", "none open — every blocker resolved (DR-054)", false);
    } else {
      const bits = [`${s.open} open`];
      if (s.gaps) bits.push(`${s.gaps} with NO owner (capability GAP)`);
      if (s.stale) bits.push(`${s.stale} overdue (>3d)`);
      add("warn", "Raised hands", `${bits.join(", ")} — dispatch them (node scripts/check-raised-hands.mjs; the blocker-dispatcher agent addresses each)`, false);
    }
  } catch (e) {
    // DR-054: the monitor failing to run is itself surfaced, never swallowed.
    add("warn", "Raised hands", `monitor could not run: ${e.message}`, false);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const icon = { ok: `${G}✓${X}`, warn: `${Y}!${X}`, fail: `${R}✗${X}` };
for (const r of rows) console.log(`  ${icon[r.state]} ${r.what.padEnd(42)} ${D}${r.detail}${X}`);

const fails = rows.filter((r) => r.state === "fail");
const gatedFails = fails.filter((r) => r.gated);
console.log("");
if (fails.length) {
  console.log(`${R}${B}${fails.length} thing(s) need you.${X} Start at the top of that list.\n`);
} else {
  console.log(`${G}${B}Nothing is silently broken.${X}\n`);
}
console.log(`${D}This checks the seams between tools. It cannot tell you whether the work`);
console.log(`was worth doing — only that nothing fell through a crack.${X}`);
console.log(
  `${D}exit code: ${gatedFails.length ? 1 : 0} — ${gatedFails.length} failing seam(s) gate it; ` +
    `the discovery rows are reported here and do not.${X}\n`,
);
process.exitCode = gatedFails.length ? 1 : 0;


// ── Self-test: the landed and ahead checks can actually fail ────────────────
// Builds a throwaway repository under the system temp dir (never inside this checkout —
// an untracked file here flips provenance.workingTreeClean on every later sim result),
// with a bare "hub" remote, and proves each shape the seam must catch or clear.
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "loop-state-selftest-"));
  // HERMETIC (round-11 review): a developer's own global or system git configuration (fetch.prune, http.sslVerify=false, merge.ff=only, core.hooksPath) turned the self-test red, and one that
  // happened to agree with a fixture could turn a case green for the wrong reason. Every git the self-test starts, fixtures and the script copies it runs alike, sees an EMPTY global
  // configuration and no system one, and no GIT_SSL_NO_VERIFY. (The environment's own GIT_CONFIG_COUNT entries stay: they are command-line scope and several cases read them.)
  const callerGitEnv = Object.fromEntries(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_SSL_NO_VERIFY"].map((k) => [k, process.env[k]]));
  const emptyGlobalConfig = join(root, "empty-global.gitconfig");
  writeFileSync(emptyGlobalConfig, "");
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig; process.env.GIT_CONFIG_NOSYSTEM = "1"; delete process.env.GIT_SSL_NO_VERIFY;
  const work = join(root, "work"), hub = join(root, "hub.git");
  const g = gitIn(work);
  const sh = (...a) => execFileSync("git", a, { cwd: work, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const put = (f, s) => writeFileSync(join(work, f), s);
  // The Hub as the seam sees it: name -> sha from `ls-remote --heads`, never from a local ref. `hb` moves the bare remote
  // behind the work clone's back (a rewind, a deletion) WITHOUT refetching, which is how a local snapshot goes stale.
  const hubMapOf = (h) => new Map(execFileSync("git", ["ls-remote", "--heads", h], { encoding: "utf8" }).split("\n").filter(Boolean)
    .map((l) => l.split(/\s+/)).filter((p) => p[1] && p[1].startsWith("refs/heads/")).map(([sha, ref]) => [ref.slice("refs/heads/".length), sha]));
  const hubMap = () => hubMapOf(hub);
  const hb = (...a) => execFileSync("git", ["-C", hub, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const cm = (f, text) => { put(f, text); sh("add", "-A"); sh("commit", "-q", "-m", f); return g("rev-parse", "HEAD"); };
  const verdictOf = (b, map = hubMap()) => sameNameVerdict(b, map.get(b), map, work);
  const checks = [];
  const check = (name, ok) => { checks.push([name, ok]); console.log(`  ${ok ? "ok  " : "FAIL"} — self-test: ${name}`); };
  try {
    execFileSync("git", ["init", "-q", "--bare", hub]);
    execFileSync("git", ["init", "-q", "-b", "main", work]);
    // hermetic: a developer's (or this sandbox's) commit.gpgsign=true would sign every fixture commit through an agent or a signing
    // service, which prompts, rate-limits and fails when two self-tests run at once; the fixtures are throwaway and unsigned
    sh("config", "commit.gpgsign", "false"); sh("config", "tag.gpgsign", "false");
    sh("remote", "add", "origin", hub);
    put("a.txt", "one\ntwo\nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "base");
    sh("push", "-q", "origin", "main");
    // feat: changes a.txt and appends to shared.md
    sh("checkout", "-q", "-b", "feat");
    put("a.txt", "one\nTWO\nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n- row 7 (feat)\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "feat");
    // mainline moves the SAME shared file elsewhere, then squash-merges feat
    sh("checkout", "-q", "main");
    put("shared.md", "- row 1\n- row 2 (main moved)\n- row 3\n- row 4\n- row 5\n- row 6\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "main moves shared");
    sh("merge", "-q", "--squash", "feat"); sh("commit", "-q", "-m", "squash feat");
    sh("push", "-q", "origin", "main");
    const M = "origin/main";
    // (a) the byte check cannot clear it (shared.md never byte-matches); the hunk check can
    check("byte check does NOT clear a squash whose shared file mainline also moved (the gap)", hasLandedByContent("feat", M, work) === false);
    check("exact-hunk check clears the same branch (a)", landedByPatchId("feat", M, work) === true);
    // (b) one more local commit after the merge → stays reported
    sh("checkout", "-q", "feat"); put("b.txt", "new\n"); sh("add", "-A"); sh("commit", "-q", "-m", "feat extended");
    check("the same branch with one more local commit stays reported (b)", landedByPatchId("feat", M, work) === false);
    // (c) whitespace-only twin of a landed change → stays reported
    sh("checkout", "-q", "-b", "feat-ws", "main~2");
    put("a.txt", "one\nTWO \nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n- row 7 (feat)\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "feat but whitespace differs");
    check("a whitespace-only twin of a landed change stays reported (c)", landedByPatchId("feat-ws", M, work) === false);
    // (d) same-named remote, local tip one ahead → ahead=1; at the tip → same; unknown sha → unknown
    sh("checkout", "-q", "-b", "same", "main"); sh("push", "-q", "origin", "same");
    const hubTip = g("rev-parse", "origin/same");
    check("a same-named branch at its Hub tip reads same (d0)", aheadOfHub("same", hubTip, work).state === "same");
    put("c.txt", "ahead\n"); sh("add", "-A"); sh("commit", "-q", "-m", "ahead of hub");
    const r = aheadOfHub("same", hubTip, work);
    check("a same-named branch one commit ahead of its Hub tip is reported with the count (d)", r.state === "ahead" && r.ahead === 1);
    check("a Hub tip not in the local store reads unknown, never clean (d-unknown)", aheadOfHub("same", "0123456789abcdef0123456789abcdef01234567", work).state === "unknown");
    // (d-alias) the same one-ahead tip, now ALSO on the Hub under another name → confirmed, not ahead
    check("with no other remote ref holding the tip, sameNameVerdict still reads ahead (d-alias-pre)", sameNameVerdict("same", hubTip, hubMap(), work).state === "ahead");
    sh("push", "-q", "origin", "same:refs/heads/elsewhere"); sh("fetch", "-q", "origin");
    const vAlias = sameNameVerdict("same", hubTip, hubMap(), work);
    check("a same-named branch ahead of its Hub name whose tip is on the Hub under another ref reads confirmed (d-alias)", vAlias.state === "confirmed" && vAlias.ahead === 1);
    // (d-alias-nomap) no Hub map at all, while the tip IS on origin/elsewhere: containment has nothing to be anchored to, so it can never confirm
    check("with no Hub sha map the branch stays ahead, never confirmed (d-alias-nomap)", sameNameVerdict("same", hubTip, undefined, work).state === "ahead" && sameNameVerdict("same", hubTip, {}, work).state === "ahead");
    // (d-alias-map) the anchored positive case again, through the map: origin/<other> equals the Hub's own sha for <other>
    check("the tip held by origin/elsewhere at the Hub's own sha for elsewhere is the one thing that confirms (d-alias-map)",
      hubNamesHoldingTip("same", hubMap(), work).join() === "elsewhere" && g("rev-parse", "origin/elsewhere") === hubMap().get("elsewhere"));
    // (d-alias-unknown) asked while the tip IS contained elsewhere: containment must never clear an unreadable comparison
    check("an unknown Hub sha still reads unknown even when the tip is on the Hub under another ref (d-alias-unknown)", sameNameVerdict("same", "0123456789abcdef0123456789abcdef01234567", hubMap(), work).state === "unknown");
    // (d-alias-fail-closed) one MORE local commit that no remote ref has → back to ahead, count 2
    put("d.txt", "unpushed\n"); sh("add", "-A"); sh("commit", "-q", "-m", "ahead again, pushed nowhere");
    const vFail = sameNameVerdict("same", hubTip, hubMap(), work);
    check("one more local commit that no remote ref holds is back to ahead with the count 2 (d-alias-fail-closed)", vFail.state === "ahead" && vFail.ahead === 2);
    check("a branch that does not resolve is never confirmed (d-alias-fail-closed2)", isOnHubBySha("no-such-branch", hubMap(), work) === false);
    // (d-same) a branch AT its Hub tip stays "same" even when that tip is also held by another Hub name (origin/main): containment
    // is asked only of a branch already proven ahead, so the verdict is never renamed "confirmed" (M4)
    sh("checkout", "-q", "-b", "mtip", "main"); sh("push", "-q", "origin", "mtip");
    const vSame = verdictOf("mtip");
    check("a branch at its Hub tip stays same although origin/main also holds that tip (d-same)", vSame.state === "same" && vSame.ahead === 0 && hubMap().get("main") === hubMap().get("mtip"));
    // The four ways a LOCAL snapshot lies about the Hub (the refuter's F1-F4). Each tip below is real work that no Hub
    // ref holds, and a version that trusted `git branch -r --contains` read every one of them "confirmed".
    // (d-F1) the Hub rewinds the same-named branch while local origin/X still sits at the old tip
    sh("checkout", "-q", "-b", "rw", "main"); const rw1 = cm("rw1.txt", "1\n"); sh("push", "-q", "origin", "rw"); cm("rw2.txt", "2\n"); sh("push", "-q", "origin", "rw");
    hb("update-ref", "refs/heads/rw", rw1);
    check("the Hub rewound the same name while origin/rw is stale at the old tip: ahead, not confirmed (d-F1)",
      g("rev-parse", "origin/rw") !== hubMap().get("rw") && verdictOf("rw").state === "ahead");
    // (d-F1b) same, but the stale ref is a DIFFERENT Hub name that the Hub still lists, at a sha that no longer matches
    sh("checkout", "-q", "-b", "stale", "main"); const st1 = cm("st1.txt", "1\n"); sh("push", "-q", "origin", "stale"); cm("st2.txt", "2\n");
    sh("push", "-q", "origin", "stale:refs/heads/stale-alias"); hb("update-ref", "refs/heads/stale-alias", st1);
    check("another Hub name listed at a different sha than the local ref holds does not confirm (d-F1b)",
      hubMap().has("stale-alias") && g("rev-parse", "origin/stale-alias") !== hubMap().get("stale-alias") && verdictOf("stale").state === "ahead");
    // (d-F2) a tracking ref for a branch the Hub has since deleted (no fetch.prune) still contains the tip
    sh("checkout", "-q", "-b", "zdel", "main"); cm("z1.txt", "1\n"); sh("push", "-q", "origin", "zdel"); cm("z2.txt", "2\n");
    sh("push", "-q", "origin", "zdel:refs/heads/zgone"); hb("update-ref", "-d", "refs/heads/zgone"); sh("fetch", "-q", "origin");
    check("a tracking ref the Hub no longer lists (deleted, not pruned) does not confirm (d-F2)",
      g("branch", "-r", "--contains", g("rev-parse", "zdel")).includes("origin/zgone") && !hubMap().has("zgone") && verdictOf("zdel").state === "ahead");
    // (d-F3) the tip is held only by a second remote, never by the Hub
    const fork = join(root, "fork.git"); execFileSync("git", ["init", "-q", "--bare", fork]); sh("remote", "add", "fork", fork);
    sh("checkout", "-q", "-b", "forked", "main"); cm("f1.txt", "1\n"); sh("push", "-q", "origin", "forked"); cm("f2.txt", "2\n"); sh("push", "-q", "fork", "forked"); sh("fetch", "-q", "fork");
    check("a ref on a second remote does not confirm (d-F3)",
      g("branch", "-r", "--contains", g("rev-parse", "forked")).includes("fork/forked") && verdictOf("forked").state === "ahead");
    // (d-F4) a hand-written refs/remotes ref that no remote owns
    sh("checkout", "-q", "-b", "handmade", "main"); cm("h1.txt", "1\n"); sh("push", "-q", "origin", "handmade"); const h2 = cm("h2.txt", "2\n");
    sh("update-ref", "refs/remotes/pr/999", h2);
    check("a hand-made refs/remotes ref does not confirm (d-F4)",
      g("branch", "-r", "--contains", h2).includes("pr/999") && verdictOf("handmade").state === "ahead");
    // The three pieces of hand-made LOCAL state that rewrite the graph or the name it is asked about (the round-2 refuter's
    // G1-G3). `raw` is git WITHOUT the guards, so each precondition proves the lie is really on offer before the guarded
    // answer is checked: without it a passing case could mean the fixture never reproduced the hole.
    const raw = (...a) => execFileSync("git", a, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const graftsFile = join(work, ".git", "info", "grafts");
    // (d-G1) `git replace --graft`: origin/g1o (local sha == the Hub's) is made a parent of the never-pushed g1t
    sh("checkout", "-q", "-b", "g1o", "main"); const g1o = cm("g1o.txt", "1\n"); sh("push", "-q", "origin", "g1o");
    sh("checkout", "-q", "-b", "g1x", "main"); const g1b = cm("g1b.txt", "1\n"); sh("push", "-q", "origin", "g1x"); const g1t = cm("g1t.txt", "2\n");
    sh("replace", "--graft", g1o, g1t);
    const g1v = verdictOf("g1x");
    check("a replace-ref graft that makes origin/g1o a parent of the unpushed tip does not confirm it (d-G1)",
      raw("for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin").split("\n").includes("g1o") &&
      g("rev-parse", "origin/g1o") === hubMap().get("g1o") && g1v.state === "ahead" && g1v.ahead === 1);
    sh("replace", "-d", g1o);
    // (d-G1b) the same trick on the count: replacing the Hub's own g1x tip with a child of g1t makes g1t reachable from it
    sh("replace", "--graft", g1b, g1t);
    const g1c = aheadOfHub("g1x", hubMap().get("g1x"), work);
    check("a replace-ref graft on the Hub's tip does not turn an ahead branch into same (d-G1b)",
      raw("rev-list", "--count", `${g1b}..refs/heads/g1x`) === "0" && g1c.state === "ahead" && g1c.ahead === 1);
    sh("replace", "-d", g1b);
    check("with the replace refs gone the plain branch still reads ahead by one (d-G1c)", verdictOf("g1x").state === "ahead" && verdictOf("g1x").ahead === 1 && !verdictOf("g1x").reason);
    // (d-G2) a legacy info/grafts file: replace-objects-off does not disable it, so the file itself must block confirmation
    writeFileSync(graftsFile, `${g1o} ${g1t}\n${g1b} ${g1t}\n`);
    const g2v = verdictOf("g1x"), g2a = aheadOfHub("g1x", hubMap().get("g1x"), work);
    const g2raw = raw("for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin").split("\n").includes("g1o");
    const g2n = hubNamesHoldingTip("g1x", hubMap(), work); // called directly, under the grafts file
    unlinkSync(graftsFile);
    check("a grafts file that makes origin/g1o a parent of the unpushed tip is not confirmed, and the row reason names the file (d-G2)",
      g2raw && g2v.state === "ahead" && g2v.ahead === null && String(g2v.reason).includes(graftsFile) && /graft file present/.test(g2v.reason));
    check("aheadOfHub under a grafts file reads unknown with the file named, never same (d-G2b)",
      g2a.state === "unknown" && String(g2a.reason).includes(graftsFile));
    check("hubNamesHoldingTip itself names no holder while a grafts file is in force, not only the verdict above it (d-G2l)", g2raw && g2n.length === 0);
    const g2r = sameNameRows([{ branch: "g1x", ...g2v }]);
    check("the fail row carries the reason and prints no invented count (d-G2c)", g2r.level === "fail" && g2r.detail.startsWith("g1x (count unreadable)") && g2r.detail.includes(graftsFile));
    check("with the grafts file removed the same branch reads ahead by one and carries no reason (d-G2d)", graftsState(work).state === "absent" && verdictOf("g1x").ahead === 1 && !verdictOf("g1x").reason);
    // (d-G2e) GIT_GRAFT_FILE points git at a grafts file anywhere: the guard must read what git would read
    const envGrafts = join(root, "env-grafts"); writeFileSync(envGrafts, `${g1o} ${g1t}\n`); process.env.GIT_GRAFT_FILE = envGrafts;
    let g2e; try { g2e = verdictOf("g1x"); } finally { delete process.env.GIT_GRAFT_FILE; }
    check("a grafts file named by GIT_GRAFT_FILE blocks confirmation and is named (d-G2e)", g2e.state === "ahead" && String(g2e.reason).includes(envGrafts));
    // (d-G2f..k) every other shape of "is a grafts file in force", each beside what git ITSELF does: rawApplied() is true only while
    // `git for-each-ref --contains` lists origin/g1o as holding the unpushed g1t, i.e. while git applies the graft. Measured on git 2.43.
    const rawApplied = (cwd = work) => execFileSync("git", ["for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").includes("g1o");
    const withEnv = (v, fn) => { process.env.GIT_GRAFT_FILE = v; try { return fn(); } finally { delete process.env.GIT_GRAFT_FILE; } };
    // (d-G2f) a 0-byte grafts file: git opens it and applies nothing, so it is no block (it used to read "graft file present" and fail the row)
    writeFileSync(graftsFile, "");
    const g2f = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a 0-byte grafts file applies no graft in git and is no block: the verdict reads ahead by one with no reason (d-G2f)",
      g2f.raw === false && g2f.st.state === "empty" && g2f.st.block === false && graftsBlock(work) === "" && g2f.v.state === "ahead" && g2f.v.ahead === 1 && !g2f.v.reason);
    // (d-G2g) the path is a directory: git warns and applies nothing
    mkdirSync(graftsFile);
    const g2g = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; rmSync(graftsFile, { recursive: true });
    check("a directory at the grafts path applies no graft in git and is no block (d-G2g)",
      g2g.raw === false && g2g.st.state === "directory" && g2g.st.block === false && g2g.v.state === "ahead" && g2g.v.ahead === 1 && !g2g.v.reason);
    // (d-G2h) a comment-only file: git applies nothing from it either, but a file with content is not parsed here, so it BLOCKS (documented, conservative)
    writeFileSync(graftsFile, "# nothing to see\n");
    const g2h = { raw: rawApplied(), st: graftsState(work) }; unlinkSync(graftsFile);
    check("a comment-only grafts file applies no graft in git yet blocks here: a file with content is not reimplemented-parsed, unknown tightens (d-G2h)",
      g2h.raw === false && g2h.st.state === "present" && g2h.st.block === true && String(g2h.st.reason).includes(graftsFile));
    // (d-G2i) GIT_GRAFT_FILE='' switches grafts off in git EVEN over a real info/grafts: no block, and the state says so (it used to name the worktree directory)
    writeFileSync(graftsFile, `${g1o} ${g1t}\n`);
    const g2iBefore = rawApplied();
    const g2i = withEnv("", () => ({ raw: rawApplied(), st: graftsState(work), blk: graftsBlock(work), v: verdictOf("g1x") })); unlinkSync(graftsFile);
    check("GIT_GRAFT_FILE='' disables grafts in git over a real info/grafts file; here it is no block and says grafts are disabled (d-G2i)",
      g2iBefore === true && g2i.raw === false && g2i.st.state === "disabled" && g2i.blk === "" && /GIT_GRAFT_FILE=''/.test(g2i.st.note) && g2i.v.state === "ahead" && g2i.v.ahead === 1 && !g2i.v.reason);
    // (d-G2j) git's own off switches: /dev/null, and a path that does not exist (while a real info/grafts sits at the default place)
    writeFileSync(graftsFile, `${g1o} ${g1t}\n`);
    const g2j = ["/dev/null", join(root, "no-such-grafts")].map((v) => withEnv(v, () => ({ raw: rawApplied(), blk: graftsBlock(work) }))); unlinkSync(graftsFile);
    check("GIT_GRAFT_FILE=/dev/null and GIT_GRAFT_FILE=<nonexistent> switch grafts off in git, and are no block here (d-G2j)", g2j.every((o) => o.raw === false && o.blk === ""));
    // (d-G2k) a RELATIVE GIT_GRAFT_FILE asked from a subdirectory: git reads it from the top of the worktree and `--git-path` prints it
    // relative to the caller, so only git's own answer finds the file (the raw env value resolved against the subdirectory and read "none")
    const relGrafts = join(work, "rel-grafts"), subDir = join(work, "sub"); mkdirSync(subDir); writeFileSync(relGrafts, `${g1o} ${g1t}\n`);
    const g2k = withEnv("rel-grafts", () => ({ raw: rawApplied(subDir), fromSub: graftsBlock(subDir), fromTop: graftsBlock(work) })); unlinkSync(relGrafts); rmSync(subDir, { recursive: true });
    check("a relative GIT_GRAFT_FILE asked from a subdirectory finds the file git applies, and names it (d-G2k)",
      g2k.raw === true && g2k.fromSub.includes(relGrafts) && g2k.fromTop.includes(relGrafts));
    // (d-G2m..r) the remaining shapes graftsState's comment lists, each compared with git ITSELF through rawApplied(). A mutant that
    // treats a symlinked grafts file as absent (lstat instead of stat) passes every case above and fails d-G2n.
    const gs_m0 = rawApplied(); // the absent baseline: no file at the default place, git applies none
    // (d-G2m) a DANGLING symlink: git cannot open it and applies nothing
    symlinkSync(join(root, "no-such-target"), graftsFile);
    const gs_m = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("an absent grafts file and a dangling symlink at its place both apply no graft in git and are no block (d-G2m)",
      gs_m0 === false && gs_m.raw === false && gs_m.st.block === false && gs_m.st.state === "absent" && gs_m.v.state === "ahead" && gs_m.v.ahead === 1 && !gs_m.v.reason);
    // (d-G2n) a SYMLINK to a real grafts file: git follows it and APPLIES the graft, so it must block
    const linkTarget = join(root, "grafts-link-target"); writeFileSync(linkTarget, `${g1o} ${g1t}\n`); symlinkSync(linkTarget, graftsFile);
    const gs_n = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a symlink to a grafts file is followed by git and blocks here, with the file named (d-G2n)",
      gs_n.raw === true && gs_n.st.block === true && gs_n.st.state === "present" && gs_n.v.state === "ahead" && gs_n.v.ahead === null && String(gs_n.v.reason).includes(graftsFile));
    // (d-G2o) a whitespace-only file: git applies none, and here a file with content blocks (documented, conservative)
    writeFileSync(graftsFile, "  \n\t\n\n");
    const gs_o = { raw: rawApplied(), st: graftsState(work) }; unlinkSync(graftsFile);
    check("a whitespace-only grafts file applies no graft in git yet blocks here, like a comment-only one (d-G2o)", gs_o.raw === false && gs_o.st.state === "present" && gs_o.st.block === true);
    // (d-G2p) CRLF line endings: git still reads the line, so it must block
    writeFileSync(graftsFile, `${g1o} ${g1t}\r\n`);
    const gs_p = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a CRLF grafts file is applied by git and blocks here (d-G2p)", gs_p.raw === true && gs_p.st.block === true && gs_p.v.state === "ahead" && gs_p.v.ahead === null);
    // (d-G2q) a comment line followed by a real graft line: git applies the graft, so it must block
    writeFileSync(graftsFile, `# a comment\n${g1o} ${g1t}\n`);
    const gs_q = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a comment line followed by a graft line is applied by git and blocks here (d-G2q)", gs_q.raw === true && gs_q.st.block === true && gs_q.v.state === "ahead" && gs_q.v.ahead === null);
    // (d-G2r) GIT_GRAFT_FILE naming ANOTHER repository's grafts file, while this repository has none of its own
    const otherRepo = join(root, "other-repo"); execFileSync("git", ["init", "-q", otherRepo]);
    const otherGrafts = join(otherRepo, ".git", "info", "grafts"); mkdirSync(join(otherRepo, ".git", "info"), { recursive: true }); writeFileSync(otherGrafts, `${g1o} ${g1t}\n`);
    const gs_r = withEnv(otherGrafts, () => ({ raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }));
    check("a GIT_GRAFT_FILE naming another repository's grafts is applied by git and blocks here, with that file named (d-G2r)",
      graftsState(work).state === "absent" && gs_r.raw === true && gs_r.st.block === true && String(gs_r.v.reason).includes(otherGrafts));
    // (d-G3) a local TAG named like the branch: tag tg at a commit the Hub holds under another name, branch tg two ahead of its Hub tip
    sh("checkout", "-q", "-b", "tg", "main"); sh("push", "-q", "origin", "tg"); const tgA = cm("tgA.txt", "1\n"); sh("push", "-q", "origin", "tg:refs/heads/tg-other");
    sh("tag", "tg", tgA); cm("tgU.txt", "2\n");
    const tgv = verdictOf("tg");
    check("a tag named like the branch does not hide its real tip: ahead by two, not confirmed (d-G3)",
      raw("rev-parse", "tg^{commit}") === tgA && tgv.state === "ahead" && tgv.ahead === 2);
    sh("tag", "-d", "tg");
    // (d-G3b) aheadOfHub: a tag at the Hub's own sha for the branch used to read an ahead branch as same
    sh("checkout", "-q", "-b", "tb", "main"); sh("push", "-q", "origin", "tb"); sh("tag", "tb"); cm("tbU.txt", "1\n");
    const tbv = aheadOfHub("tb", hubMap().get("tb"), work);
    check("a tag at the Hub's own sha does not make an ahead branch read same (d-G3b)", raw("rev-list", "--count", `${hubMap().get("tb")}..tb`) === "0" && tbv.state === "ahead" && tbv.ahead === 1);
    sh("tag", "-d", "tb");
    // (d-G3c) isOnHubBySha: a tag on a Hub-held commit named like a local-only branch must not clear that branch
    sh("checkout", "-q", "-b", "tc", "main"); cm("tcU.txt", "1\n"); sh("tag", "tc", "main");
    check("a tag named like a local-only branch does not make its unpushed tip look like it is on the Hub (d-G3c)",
      raw("branch", "-r", "--contains", raw("rev-parse", "tc^{commit}")).includes("origin/main") && isOnHubBySha("tc", hubMap(), work) === false);
    sh("tag", "-d", "tc");
    // (d-rows) the row text names a confirmed branch, and the title says what the ok row covers (M5)
    const rowsOk = sameNameRows([{ branch: "b-same", state: "same", ahead: 0 }, { branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "b-unk", state: "unknown" }]);
    check("the ok row names the confirmed branch and counts the compared ones (d-rows)",
      rowsOk.level === "ok" && rowsOk.detail.includes("claude/conf-branch") && rowsOk.detail.startsWith("2 branch(es) compared by sha") && /confirmed on the Hub under another branch/.test(rowsOk.title));
    const rowsFail = sameNameRows([{ branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "x-ahead", state: "ahead", ahead: 2 }]);
    check("the fail row names the ahead branch with its count and still names the confirmed one (d-rows-fail)",
      rowsFail.level === "fail" && rowsFail.detail.startsWith("x-ahead (+2)") && rowsFail.detail.includes("claude/conf-branch"));
    check("with nothing confirmed the row carries no confirmed note (d-rows-none)", !/confirmed/.test(sameNameRows([{ branch: "b", state: "same", ahead: 0 }]).detail));
    // ── The inputs the CALLER produces. Every case below builds its own repository and Hub, lists the branches with
    // listLocalBranches and builds the rows with branchSeamRows: the very code the live script runs, so a tag, a same-named
    // ref or a broken ref changes the listing exactly as it would live. (Round 3's cases handed the guards inputs the live
    // caller never produced, which is how a listing that shortened a branch to `heads/<name>` went unnoticed.)
    const FX_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const mkFx = (name) => {
      const dir = join(root, name), w = join(dir, "work"), h = join(dir, "hub.git");
      mkdirSync(dir);
      execFileSync("git", ["init", "-q", "--bare", h]);
      execFileSync("git", ["init", "-q", "-b", "main", w]);
      const f = (...a) => execFileSync("git", a, { cwd: w, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: FX_ENV }).trim();
      const c = (file, text, msg = file) => { writeFileSync(join(w, file), text); f("add", "-A"); f("commit", "-q", "-m", msg); return f("rev-parse", "HEAD"); };
      f("config", "commit.gpgsign", "false"); f("config", "tag.gpgsign", "false"); // hermetic, as for the main fixture above
      f("remote", "add", "origin", h);
      c("base.txt", "base\n"); f("push", "-q", "origin", "main");
      const rows = (extra = {}) => { const m = hubMapOf(h); return branchSeamRows({ listing: listLocalBranches(w), hubBranches: [...m.keys()], hubShaMap: m, ephemeral: [], scratchExcluded: [], mainline: "refs/remotes/origin/main", cwd: w, ...extra }); };
      const put = (file, text) => writeFileSync(join(w, file), text);
      return { w, h, f, c, put, rows };
    };
    const rowOf = (rs, what) => rs.find((x) => x.what === what);
    const T_UNPUSHED = "Local work not on the Review Hub", T_CLEAN = "Local branches all present on the Review Hub", T_AHEAD = "Local tip ahead of its same-named Hub branch";
    const shortNames = (fx) => fx.f("branch", "--format=%(refname:short)").split("\n"); // what round 3 listed
    // (E1) a branch exactly at its Hub tip, and a tag with its name: git shortens the branch to heads/v1
    const e1 = mkFx("e1");
    e1.f("checkout", "-q", "-b", "v1"); e1.c("rel.txt", "1\n"); e1.f("push", "-q", "origin", "v1"); e1.f("tag", "v1");
    const e1l = listLocalBranches(e1.w), e1r = e1.rows();
    check("a branch at its Hub tip with a same-named tag is listed by its real name, and both rows stay clean (E1)",
      shortNames(e1).includes("heads/v1") && e1l.ok && e1l.names.includes("v1") && !e1l.names.includes("heads/v1") &&
      e1r.length === 2 && e1r.every((x) => x.state === "ok") && /^2 branch\(es\) compared by sha/.test(e1r[1].detail));
    // (E2a) real unpushed work on refs/heads/X, a tag X, and a Hub branch literally named heads/X
    const e2a = mkFx("e2a");
    e2a.f("push", "-q", "origin", "main:refs/heads/heads/X"); e2a.f("fetch", "-q", "origin");
    e2a.f("checkout", "-q", "-b", "X"); e2a.c("work.txt", "real unpushed work\n"); e2a.f("tag", "X", "main");
    const e2aU = rowOf(e2a.rows(), T_UNPUSHED);
    check("real unpushed work on refs/heads/X beside a Hub branch named heads/X and a tag X is a gated failure naming X (E2a)",
      shortNames(e2a).includes("heads/X") && listLocalBranches(e2a.w).names.includes("X") && !!e2aU && e2aU.state === "fail" && e2aU.gated === true && e2aU.detail.split(" — ")[0] === "X");
    // (E2b) the same, with a LOCAL branch heads/X too (it is at the Hub's heads/X): X is still the only unpushed name
    const e2b = mkFx("e2b");
    e2b.f("push", "-q", "origin", "main:refs/heads/heads/X"); e2b.f("fetch", "-q", "origin"); e2b.f("branch", "heads/X", "main");
    e2b.f("checkout", "-q", "-b", "X"); e2b.c("work.txt", "real unpushed work\n"); e2b.f("tag", "X", "main");
    const e2bR = e2b.rows(), e2bU = rowOf(e2bR, T_UNPUSHED);
    check("with a local branch heads/X as well, X alone is reported unpushed and heads/X compares clean (E2b)",
      !!e2bU && e2bU.state === "fail" && e2bU.detail.split(" — ")[0] === "X" && rowOf(e2bR, "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch").state === "ok");
    // (G3-live) tag tg on a commit the Hub holds under another name; branch tg two ahead of the Hub's tg
    const g3l = mkFx("g3live");
    g3l.f("checkout", "-q", "-b", "tg"); g3l.f("push", "-q", "origin", "tg"); const g3lA = g3l.c("A.txt", "1\n"); g3l.f("push", "-q", "origin", "tg:refs/heads/tg-other");
    g3l.f("tag", "tg", g3lA); g3l.c("U.txt", "2\n");
    const g3lR = g3l.rows(), g3lA2 = rowOf(g3lR, T_AHEAD);
    check("a tag on a Hub-held commit named like a branch two ahead: the same-name row fails with +2, never confirmed, never landed (G3-live)",
      shortNames(g3l).includes("heads/tg") && !!g3lA2 && g3lA2.state === "fail" && g3lA2.detail.startsWith("tg (+2)") &&
      !/but confirmed on the Hub under another branch/.test(g3lA2.detail) && !/squash-landed/.test(JSON.stringify(g3lR)));
    // (caution-bytes) a local-only branch with real work; a tag with its name on the ORIGINAL commit of a squash-merged change whose bytes are in mainline.
    const cauA = mkFx("cautionA");
    cauA.f("checkout", "-q", "--detach"); const cauAz = cauA.c("f.txt", "landed\n"); cauA.f("tag", "X", cauAz);
    cauA.f("checkout", "-q", "main"); cauA.c("f.txt", "landed\n", "squash of f"); cauA.f("push", "-q", "origin", "main");
    cauA.f("branch", "probe", cauAz); const cauAprobe = hasLandedByContent("probe", "refs/remotes/origin/main", cauA.w); cauA.f("branch", "-q", "-D", "probe");
    cauA.f("checkout", "-q", "-b", "X", cauAz); cauA.c("g.txt", "real work, not in mainline\n");
    const cauAu = rowOf(cauA.rows(), T_UNPUSHED);
    check("a tag named like a local-only branch, on a commit whose bytes are in mainline, does not clear the branch's real work as squash-landed (caution-bytes)",
      cauAprobe === true && cauA.f("diff", "--name-only", "refs/remotes/origin/main...X") === "f.txt" && !!cauAu && cauAu.state === "fail" && cauAu.detail.split(" — ")[0] === "X" && !/squash-landed/.test(cauAu.detail));
    // (caution-hunks) the same for the exact-hunk check: the tag sits on the original commit of a squash whose shared file mainline also moved
    const cauB = mkFx("cautionB");
    const shared0 = "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n", sharedMain = "- row 1\n- row 2 (main moved)\n- row 3\n- row 4\n- row 5\n- row 6\n";
    cauB.c("shared.md", shared0); cauB.f("push", "-q", "origin", "main");
    cauB.f("checkout", "-q", "--detach"); const cauBz = cauB.c("shared.md", `${shared0}- row 7 (feat)\n`); cauB.f("tag", "X", cauBz);
    cauB.f("checkout", "-q", "main"); cauB.c("shared.md", sharedMain); cauB.c("shared.md", `${sharedMain}- row 7 (feat)\n`, "squash of feat"); cauB.f("push", "-q", "origin", "main");
    cauB.f("branch", "probe", cauBz); const cauBprobe = landedByPatchId("probe", "refs/remotes/origin/main", cauB.w); cauB.f("branch", "-q", "-D", "probe");
    cauB.f("checkout", "-q", "-b", "X", cauBz); cauB.c("g.txt", "real work, not in mainline\n");
    const cauBu = rowOf(cauB.rows(), T_UNPUSHED);
    check("a tag named like a local-only branch, on a commit whose hunks are a mainline squash, does not clear the branch's real work (caution-hunks)",
      cauBprobe === true && !!cauBu && cauBu.state === "fail" && cauBu.detail.split(" — ")[0] === "X" && !/squash-landed/.test(cauBu.detail));
    // (m-tag) MAINLINE is a full refname: a local tag named origin/main outranks the remote-tracking ref in a bare resolution
    const mt = mkFx("mltag");
    mt.f("checkout", "-q", "--detach"); mt.c("q.txt", "same bytes\n", "tag side"); mt.f("tag", "origin/main");
    mt.f("checkout", "-q", "-b", "X", "main"); mt.c("q.txt", "same bytes\n", "branch side");
    check("a tag named like the remote-tracking mainline cannot stand in for it: the bare name is shown to lie, the full refname is not fooled, and MAINLINE is a full refname (m-tag)",
      hasLandedByContent("X", "origin/main", mt.w) === true && hasLandedByContent("X", "refs/remotes/origin/main", mt.w) === false && MAINLINE.startsWith("refs/remotes/origin/"));
    // (E-broken) for-each-ref SKIPS a broken ref with only a warning on stderr and exits 0
    const eb = mkFx("ebroken");
    eb.f("branch", "brk"); writeFileSync(join(eb.w, ".git", "refs", "heads", "brk"), "garbage\n");
    const ebL = listLocalBranches(eb.w), ebR = eb.rows();
    check("a branch ref git cannot read is an unreadable listing (a gated failing row), not a branch that is not there (E-broken)",
      ebL.ok === false && /broken ref/.test(String(ebL.error)) && ebR.length === 1 && ebR[0].state === "fail" && ebR[0].gated === true && ebR[0].what === "Local branch list unreadable");
    // (E-listfail) git failing outright: asked in a directory that is no repository. (Until round 9 this planted GIT_DIR at a missing directory, which gitEnv now
    // drops on purpose, so it would have listed the fixture's branches -- and the 'ebroken' fixture's broken ref made the case pass anyway; R9-env-gitdir covers the env.)
    const lfNoRepo = join(root, "no-repo-here"); mkdirSync(lfNoRepo);
    const lf = listLocalBranches(lfNoRepo);
    const lfRows = branchSeamRows({ listing: lf, hubBranches: ["main"], hubShaMap: new Map(), ephemeral: [], scratchExcluded: [] });
    check("a failed branch listing is a gated failing row 'Local branch list unreadable', never an empty clean list (E-listfail)",
      lf.ok === false && lf.names.length === 0 && lfRows.length === 1 && lfRows[0].state === "fail" && lfRows[0].gated === true && lfRows[0].what === "Local branch list unreadable" &&
      branchListRow(lf).gated === true && branchListRow(listLocalBranches(eb.w.replace("ebroken", "e1"))) === null);
    // (E-carry) an ephemeral agent-worktree branch with a commit no origin ref holds, and a tag named like it on a Hub-held commit:
    // the bare name would count the tag's history (zero) and the warning would never name the branch
    const ecar = mkFx("ecarry");
    ecar.f("checkout", "-q", "-b", "eph"); ecar.c("eph.txt", "agent work\n"); ecar.f("tag", "eph", "main"); ecar.f("checkout", "-q", "main");
    const ecarRow = rowOf(ecar.rows({ ephemeral: ["eph"] }), "Agent-worktree branches carrying commits");
    check("an agent-worktree branch carrying a commit no origin ref holds is named with its count although a tag shares its name (E-carry)",
      !!ecarRow && ecarRow.state === "warn" && ecarRow.gated === false && ecarRow.detail.startsWith("eph (+1)"));
    // (R1-HEAD) a REAL branch refs/heads/HEAD (git update-ref makes one; for-each-ref refs/heads/ yields it as the bare name HEAD)
    // with unpushed work. Round 4 filtered the name out of the unpushed list, so this read "all present on the Review Hub", exit 0.
    const hh = mkFx("headhead");
    hh.f("checkout", "-q", "-b", "side"); const hhTip = hh.c("hh.txt", "real unpushed work\n"); hh.f("update-ref", "refs/heads/HEAD", hhTip);
    hh.f("checkout", "-q", "main"); hh.f("branch", "-q", "-D", "side");
    const hhL = listLocalBranches(hh.w), hhU = rowOf(hh.rows(), T_UNPUSHED);
    check("unpushed work on a branch literally named HEAD (refs/heads/HEAD) is a gated failure naming HEAD (R1-HEAD)",
      hhL.ok && hhL.names.includes("HEAD") && !!hhU && hhU.state === "fail" && hhU.gated === true && hhU.detail.split(" — ")[0] === "HEAD");
    // (R1-HEAD2) the same name on BOTH sides: the Hub has a branch HEAD and the local one is a commit ahead of it
    const hh2 = mkFx("headhead2");
    hh2.f("push", "-q", "origin", "main:refs/heads/HEAD");
    hh2.f("checkout", "-q", "-b", "side"); const hh2Tip = hh2.c("hh2.txt", "ahead of the Hub's HEAD\n"); hh2.f("update-ref", "refs/heads/HEAD", hh2Tip);
    hh2.f("checkout", "-q", "main"); hh2.f("branch", "-q", "-D", "side");
    const hh2A = rowOf(hh2.rows(), T_AHEAD);
    check("a local branch HEAD one commit ahead of a Hub branch HEAD is a gated same-name failure, +1 (R1-HEAD2)",
      hubMapOf(hh2.h).has("HEAD") && !!hh2A && hh2A.state === "fail" && hh2A.gated === true && hh2A.detail.startsWith("HEAD (+1)"));
    // (R2-warn) a deprecated config key prints a warning on EVERY git command and exits 0: it must not fail the listing, and must be named
    const wn = mkFx("warnbenign");
    wn.f("branch", "-q", "side-ok"); wn.f("push", "-q", "origin", "side-ok");
    // Runs fn with git config pairs set through GIT_CONFIG_COUNT/KEY_n/VALUE_n, then puts back what those variables held BEFORE
    // (the harness this runs under exports its own GIT_CONFIG_*), never deletes them.
    const withGitConfig = (pairs, fn) => {
      const keys = ["GIT_CONFIG_COUNT", ...pairs.flatMap((_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`])], prior = keys.map((k) => process.env[k]);
      process.env.GIT_CONFIG_COUNT = String(pairs.length);
      pairs.forEach(([k, v], i) => { process.env[`GIT_CONFIG_KEY_${i}`] = k; process.env[`GIT_CONFIG_VALUE_${i}`] = v; });
      try { return fn(); } finally { keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); }
    };
    const withFsync = (fn) => withGitConfig([["core.fsyncObjectFiles", "true"]], fn);
    const wnPlain = listLocalBranches(wn.w);
    const wnL = withFsync(() => listLocalBranches(wn.w)), wnC = withFsync(() => rowOf(wn.rows(), T_CLEAN));
    check("a benign git warning (deprecated core.fsyncObjectFiles) leaves the listing ok and the verdict clean, and the row names the warning (R2-warn)",
      wnPlain.ok && wnPlain.warnings.length === 0 && wnL.ok && wnL.names.includes("side-ok") && wnL.warnings.some((w) => /core\.fsyncObjectFiles is deprecated/.test(w)) &&
      !!wnC && wnC.state === "ok" && /git warned while listing branches, verdict unaffected: warning: core\.fsyncObjectFiles is deprecated/.test(wnC.detail));
    // (R2-warn2) ...and the same warning does NOT mask a broken ref: the ref-skip warning still fails the listing
    const wb = mkFx("warnbroken");
    wb.f("branch", "brk"); writeFileSync(join(wb.w, ".git", "refs", "heads", "brk"), "garbage\n");
    const wbL = withFsync(() => listLocalBranches(wb.w));
    check("with a benign warning ALSO printed, a broken ref is still an unreadable listing (R2-warn2)", wbL.ok === false && /ignoring broken ref/.test(String(wbL.error)));
    // (R3-graft) real unpushed work Y; the Hub's `other` is made to "contain" Y by a grafts file; `git branch -r --contains` then says Y is on origin/other
    const gu = mkFx("graftunpushed");
    gu.f("checkout", "-q", "-b", "other"); const guO = gu.c("o.txt", "o\n"); gu.f("push", "-q", "origin", "other");
    gu.f("checkout", "-q", "-b", "Y", "main"); const guT = gu.c("y.txt", "real unpushed work\n");
    const guGrafts = join(gu.w, ".git", "info", "grafts"); writeFileSync(guGrafts, `${guO} ${guT}\n`);
    const guLie = gu.f("branch", "-r", "--contains", guT).split("\n").map((l) => l.trim()).includes("origin/other");
    const guRows = gu.rows(), guU = rowOf(guRows, T_UNPUSHED); unlinkSync(guGrafts);
    check("a grafts file that makes origin/other contain unpushed work does not clear it as 'on the hub under another name': a gated failure naming Y, with the grafts file as the reason (R3-graft)",
      guLie && !!guU && guU.state === "fail" && guU.gated === true && guU.detail.split(" — ")[0] === "Y" && !/on the hub under another name/.test(guU.detail) &&
      /alias and squash-landed exemptions OFF: graft file present/.test(guU.detail) && guU.detail.includes(guGrafts));
    // (R3-pr999) a hand-made refs/remotes/pr/999 at the unpushed tip: the shared checkout carries refs/remotes/pr/* refs (count them: git for-each-ref refs/remotes/pr/)
    const pr = mkFx("pr999");
    pr.f("checkout", "-q", "-b", "Y"); const prT = pr.c("y.txt", "real unpushed work\n"); pr.f("update-ref", "refs/remotes/pr/999", prT);
    const prLie = pr.f("branch", "-r", "--contains", prT).includes("pr/999"), prU = rowOf(pr.rows(), T_UNPUSHED);
    check("a hand-made refs/remotes/pr/999 holding the tip does not clear unpushed work: a gated failure naming Y (R3-pr999)",
      prLie && !!prU && prU.state === "fail" && prU.gated === true && prU.detail.split(" — ")[0] === "Y" && !/on the hub under another name/.test(prU.detail));
    // (R3-alias) the LEGITIMATE alias still clears and is named: pr782 at the tip of Hub branch `other` (local origin/other fetched, at the Hub's sha)
    const al = mkFx("aliasok");
    al.f("checkout", "-q", "-b", "other"); al.c("o.txt", "o\n"); al.f("push", "-q", "origin", "other"); al.f("fetch", "-q", "origin");
    al.f("checkout", "-q", "-b", "pr782", "other");
    const alR = al.rows(), alC = rowOf(alR, T_CLEAN);
    check("a branch whose tip is on the Hub under another name, at the Hub's own sha, is still cleared and named (R3-alias)",
      !!alC && alC.state === "ok" && /\(1 on the hub under another name: pr782\)/.test(alC.detail) && !rowOf(alR, T_UNPUSHED));
    // (R3-alias-stale) the same branch after the Hub REWOUND `other` below the tip while local origin/other kept the old sha: no longer cleared
    const as = mkFx("aliasstale");
    as.f("checkout", "-q", "-b", "other"); const asO1 = as.c("o1.txt", "1\n"); as.c("o2.txt", "2\n"); as.f("push", "-q", "origin", "other"); as.f("fetch", "-q", "origin");
    as.f("checkout", "-q", "-b", "pr782", "other");
    execFileSync("git", ["-C", as.h, "update-ref", "refs/heads/other", asO1], { stdio: "ignore" });
    const asU = rowOf(as.rows(), T_UNPUSHED);
    check("a branch whose only holder is a local origin/other the Hub has since rewound is a gated failure naming it (R3-alias-stale)",
      as.f("rev-parse", "refs/remotes/origin/other") !== hubMapOf(as.h).get("other") && !!asU && asU.state === "fail" && asU.gated === true && asU.detail.split(" — ")[0] === "pr782" &&
      // the Hub's rewound sha IS local and does not hold the tip: a fetch changes nothing, so the remedy stays the push/confirm one
      /push, or confirm the remote/.test(asU.detail) && !asU.detail.includes("git fetch origin"));
    // (R4-M1) a local-only branch whose name contains a slash and begins `tags/`: the bare name `tags/rel` resolves refs/tags/rel (the DWIM rule
    // refs/<name>), the tag, so a headRef that qualifies only names WITHOUT a slash lets the tag's squash-landed commit clear the branch's real work
    const m1 = mkFx("m1slash");
    m1.f("checkout", "-q", "--detach"); const m1z = m1.c("f.txt", "landed\n"); m1.f("tag", "rel", m1z);
    m1.f("checkout", "-q", "main"); m1.c("f.txt", "landed\n", "squash of f"); m1.f("push", "-q", "origin", "main");
    m1.f("checkout", "-q", "-b", "tags/rel", m1z); m1.c("g.txt", "real work, not in mainline\n");
    const m1Rows = m1.rows(), m1U = rowOf(m1Rows, T_UNPUSHED);
    check("a local-only branch tags/rel with real work beside a tag rel on a squash-landed commit is not cleared as squash-landed: headRef qualifies names with a slash too (R4-M1)",
      m1.f("rev-parse", "tags/rel^{commit}") === m1z && headRef("tags/rel") === "refs/heads/tags/rel" && !!m1U && m1U.state === "fail" && m1U.gated === true &&
      m1U.detail.split(" — ")[0] === "tags/rel" && !/squash-landed/.test(JSON.stringify(m1Rows)));
    // ══ ROUND 6 ══ The refuter's p1a-p1g fixtures, rebuilt here beside the rows they must change. Each case states its own
    // precondition (the lie really is on offer in the fixture) before the guarded answer is checked.
    const R6M = "refs/remotes/origin/main", T_UNKNOWN = "Same-named branches whose Hub tip is not fetched locally";
    const FETCH = (n) => `origin/${n} is behind the Hub: run git fetch origin, then re-run`;
    // The Hub moves <name> forward by one commit WITHOUT the work clone fetching it: plumbing in the bare repo, no clone, no network.
    const hubAdvance = (fx, name) => {
      const hg = (...a) => execFileSync("git", ["-C", fx.h, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: FX_ENV }).trim();
      const parent = hg("rev-parse", `refs/heads/${name}`);
      const next = hg("commit-tree", `${parent}^{tree}`, "-p", parent, "-m", `hub moves ${name} forward`);
      hg("update-ref", `refs/heads/${name}`, next);
      return next;
    };
    const hasObject = (fx, sha) => { try { execFileSync("git", ["-C", fx.w, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } };
    // (C) the walks end at the fork. p1a: mainline went v1 -> v2 -> v1 (a revert); the branch forked at the revert and re-applies v2.
    const pa = mkFx("r6a");
    pa.c("f.txt", "v1\n"); const paA = pa.c("f.txt", "v2 FEATURE\n", "A: feature"); pa.c("f.txt", "v1\n", "B: revert A"); pa.f("push", "-q", "origin", "main");
    pa.f("checkout", "-q", "-b", "rr"); pa.c("f.txt", "v2 FEATURE\n", "revert B (re-apply the feature)");
    const paRows = pa.rows(), paU = rowOf(paRows, T_UNPUSHED);
    check("a local re-apply of a change mainline already reverted matches a blob from BEFORE the fork and is still reported: both landed checks false (R6-p1a, revert of a revert)",
      pa.f("rev-parse", `${paA}:f.txt`) === pa.f("rev-parse", "refs/heads/rr:f.txt") && pa.f("merge-base", R6M, "refs/heads/rr") === pa.f("rev-parse", R6M) &&
      hasLandedByContent("rr", R6M, pa.w) === false && landedByPatchId("rr", R6M, pa.w) === false &&
      !!paU && paU.state === "fail" && paU.gated === true && paU.detail.split(" — ")[0] === "rr" && !/squash-landed/.test(JSON.stringify(paRows)));
    // p1a2: the plain revert: mainline went v1 -> v2, the branch forked at v2 and restores v1
    const pb = mkFx("r6b");
    const pbV1 = pb.c("f.txt", "v1 old\n"); pb.c("f.txt", "v2 current\n", "A"); pb.f("push", "-q", "origin", "main");
    pb.f("checkout", "-q", "-b", "rv"); pb.c("f.txt", "v1 old\n", "revert A");
    const pbRows = pb.rows(), pbU = rowOf(pbRows, T_UNPUSHED);
    check("a local plain revert of mainline's last change to a file is still reported, not cleared by the file's pre-fork blob (R6-p1a2)",
      pb.f("rev-parse", `${pbV1}:f.txt`) === pb.f("rev-parse", "refs/heads/rv:f.txt") && hasLandedByContent("rv", R6M, pb.w) === false && landedByPatchId("rv", R6M, pb.w) === false &&
      !!pbU && pbU.state === "fail" && pbU.gated === true && pbU.detail.split(" — ")[0] === "rv" && !/squash-landed/.test(JSON.stringify(pbRows)));
    // the bound must not over-restrict: content that landed AFTER the fork and was then overtaken (the moved-on hole) is still cleared
    const mo = mkFx("r6mo");
    mo.c("f.txt", "base\n"); mo.f("push", "-q", "origin", "main"); mo.f("checkout", "-q", "-b", "feat"); mo.c("f.txt", "landed\n", "feat");
    mo.f("checkout", "-q", "main"); mo.c("f.txt", "landed\n", "squash of feat"); mo.c("f.txt", "landed\nmoved on\n", "next merge"); mo.f("push", "-q", "origin", "main");
    check("content that landed after the fork and was then overtaken by a later change to the same file is still cleared by bytes (R6-moved-on)",
      mo.f("rev-parse", "refs/heads/feat:f.txt") !== mo.f("rev-parse", `${R6M}:f.txt`) && hasLandedByContent("feat", R6M, mo.w) === true);
    // (B) object ids, never text. p1c: a file over Node's 1 MiB default maxBuffer, edited on the branch only.
    const pc = mkFx("r6c");
    const big = `${"x".repeat(1100000)}\n`;
    pc.c("big.md", big); pc.f("push", "-q", "origin", "main");
    pc.f("checkout", "-q", "-b", "bigwork"); pc.c("big.md", big.replace(/^x/, "REAL UNPUSHED EDIT "), "real work in the big file");
    let enobufs = false;
    try { execFileSync("git", ["show", "refs/heads/bigwork:big.md"], { cwd: pc.w, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { enobufs = Boolean(e && e.code === "ENOBUFS"); }
    const pcRows = pc.rows(), pcU = rowOf(pcRows, T_UNPUSHED);
    check("a file over 1 MiB with a real unpushed edit is reported, not cleared because both sides failed to read as \"\" (R6-p1c)",
      enobufs && pc.f("rev-parse", "refs/heads/bigwork:big.md") !== pc.f("rev-parse", `${R6M}:big.md`) && hasLandedByContent("bigwork", R6M, pc.w) === false &&
      !!pcU && pcU.state === "fail" && pcU.gated === true && pcU.detail.split(" — ")[0] === "bigwork" && !/squash-landed/.test(JSON.stringify(pcRows)));
    check("gitIn reads output past 1 MiB (a 64 MiB maxBuffer) instead of swallowing the overflow as an empty answer (R6-maxbuffer)", gitIn(pc.w)("show", "refs/heads/bigwork:big.md").length > 1000000);
    // ...and the same big file, when mainline really carries the branch's blob, is still cleared (no false positive from the change)
    pc.f("checkout", "-q", "main"); pc.c("big.md", big.replace(/^x/, "LANDED "), "squash of the big edit"); pc.f("push", "-q", "origin", "main");
    pc.f("checkout", "-q", "-b", "biglanded", "main~1"); pc.c("big.md", big.replace(/^x/, "LANDED "), "the big edit, original commit");
    check("a file over 1 MiB whose bytes ARE mainline's blob is still cleared as squash-landed (R6-p1c-pos)", hasLandedByContent("biglanded", R6M, pc.w) === true);
    // p1g: a difference that trim() erases (indentation, trailing blank lines in YAML)
    const pg = mkFx("r6g");
    pg.c("conf.yml", "key: value\n"); pg.f("push", "-q", "origin", "main"); pg.f("checkout", "-q", "-b", "indent"); pg.c("conf.yml", "  key: value\n\n\n");
    const pgRows = pg.rows(), pgU = rowOf(pgRows, T_UNPUSHED);
    check("a trim-only difference (indentation and trailing blank lines) is a difference: the texts trim equal, the blob ids do not, the branch is reported (R6-p1g)",
      pg.f("show", "refs/heads/indent:conf.yml") === pg.f("show", `${R6M}:conf.yml`) && pg.f("rev-parse", "refs/heads/indent:conf.yml") !== pg.f("rev-parse", `${R6M}:conf.yml`) &&
      hasLandedByContent("indent", R6M, pg.w) === false && !!pgU && pgU.state === "fail" && pgU.detail.split(" — ")[0] === "indent");
    // a mode-only change has the same blob id and is still a change
    const pm = mkFx("r6m");
    pm.c("run.sh", "echo hi\n"); pm.f("push", "-q", "origin", "main"); pm.f("checkout", "-q", "-b", "chmod"); pm.f("update-index", "--chmod=+x", "run.sh"); pm.f("commit", "-q", "-m", "chmod +x");
    check("a chmod-only change (same blob id, different mode) is reported, not cleared as byte-identical (R6-chmod)",
      pm.f("rev-parse", "refs/heads/chmod:run.sh") === pm.f("rev-parse", `${R6M}:run.sh`) && pm.f("diff", "--name-only", `${R6M}...refs/heads/chmod`) === "run.sh" && hasLandedByContent("chmod", R6M, pm.w) === false);
    // a path git QUOTES in plain diff output: "\303\244.txt" names no path, so BOTH sides were missing and "" === ""
    const pq = mkFx("r6q");
    pq.c("ä.txt", "original\n"); pq.f("push", "-q", "origin", "main"); pq.f("checkout", "-q", "-b", "qb"); pq.c("ä.txt", "real unpushed change\n");
    const pqU = rowOf(pq.rows(), T_UNPUSHED);
    check("a real change to a file with a non-ASCII name (git quotes it in plain diff output) is reported, not read as missing on both sides (R6-quote)",
      pq.f("diff", "--name-only", `${R6M}...refs/heads/qb`).startsWith("\"") && hasLandedByContent("qb", R6M, pq.w) === false && !!pqU && pqU.state === "fail" && pqU.detail.split(" — ")[0] === "qb");
    // a RENAME is listed under its new name only by default: the old path's deletion was never compared
    const pr6 = mkFx("r6rn");
    const rnBody = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
    pr6.c("old.txt", rnBody); pr6.f("push", "-q", "origin", "main"); pr6.f("checkout", "-q", "-b", "mv"); pr6.f("mv", "old.txt", "new.txt"); pr6.f("commit", "-q", "-m", "rename old to new");
    pr6.f("checkout", "-q", "main"); pr6.c("new.txt", rnBody, "main gains a copy and keeps old.txt"); pr6.f("push", "-q", "origin", "main");
    check("a rename whose new name mainline already carries, while mainline still has the OLD path, is reported: the deleted old path counts (R6-rename)",
      pr6.f("diff", "--name-only", `${R6M}...refs/heads/mv`) === "new.txt" && hasLandedByContent("mv", R6M, pr6.w) === false);
    // a path missing on BOTH sides is the same state (the INFO case), and one removed by the branch but kept by mainline is not
    const pb2 = mkFx("r6db");
    pb2.c("g.txt", "g\n"); pb2.f("push", "-q", "origin", "main"); pb2.f("checkout", "-q", "-b", "del"); pb2.f("rm", "-q", "g.txt"); pb2.f("commit", "-q", "-m", "del g");
    pb2.f("checkout", "-q", "main"); pb2.f("rm", "-q", "g.txt"); pb2.f("commit", "-q", "-m", "main del g"); pb2.c("h.txt", "h\n"); pb2.f("push", "-q", "origin", "main");
    check("a branch that only deletes a file mainline also deleted is still cleared: missing on both sides is the same state (R6-del-both)",
      pb2.f("ls-tree", "--name-only", R6M, "g.txt") === "" && hasLandedByContent("del", R6M, pb2.w) === true);
    const pk = mkFx("r6dk");
    pk.c("g.txt", "g\n"); pk.f("push", "-q", "origin", "main"); pk.f("checkout", "-q", "-b", "rmkeep"); pk.f("rm", "-q", "g.txt"); pk.f("commit", "-q", "-m", "branch deletes g");
    pk.f("checkout", "-q", "main"); pk.c("h.txt", "h\n"); pk.f("push", "-q", "origin", "main");
    check("a branch that deletes a file mainline still has is a difference, not cleared (R6-del-kept)",
      pk.f("ls-tree", "--name-only", R6M, "g.txt") === "g.txt" && hasLandedByContent("rmkeep", R6M, pk.w) === false);
    // (A) ancestry against the Hub's own listing. p1d: the tip IS the sha the Hub lists for another name, pushed by URL (no tracking ref written)
    const pd = mkFx("r6d");
    pd.f("checkout", "-q", "-b", "mine"); const pdT = pd.c("m.txt", "work\n"); pd.f("push", "-q", pd.h, "mine:refs/heads/other");
    const pdMap = hubMapOf(pd.h), pdRows = pd.rows(), pdC = rowOf(pdRows, T_CLEAN);
    check("a tip equal to a sha the Hub lists for another name is on the Hub even with no tracking ref for it: cleared and named (R6-p1d)",
      pd.f("for-each-ref", "refs/remotes/origin/other") === "" && pdMap.get("other") === pdT && hubNamesHoldingTip("mine", pdMap, pd.w).join() === "other" &&
      !!pdC && pdC.state === "ok" && /\(1 on the hub under another name: mine\)/.test(pdC.detail) && !rowOf(pdRows, T_UNPUSHED));
    // p1e: the holder is BEHIND the Hub (the Hub moved `other` forward after the last fetch), and the Hub's new sha IS in the local store
    const mkBehind = (name) => {
      const x = mkFx(name);
      x.f("checkout", "-q", "-b", "other"); const o = x.c("o.txt", "o\n"); x.f("push", "-q", "origin", "other");
      x.f("checkout", "-q", "-b", "pr782", "other"); x.f("branch", "-q", "-D", "other");
      return { x, o, o2: hubAdvance(x, "other") };
    };
    const pe = mkBehind("r6e");
    pe.x.f("fetch", "-q", pe.x.h, "refs/heads/other:refs/remotes/stash/other"); // by URL: the object arrives, origin/other does not move
    const peRows = pe.x.rows(), peC = rowOf(peRows, T_CLEAN);
    check("a holder BEHIND the Hub, with the Hub's newer sha in the local store, still clears the branch by ancestry and names it (R6-p1e)",
      pe.x.f("rev-parse", "refs/remotes/origin/other") === pe.o && hubMapOf(pe.x.h).get("other") === pe.o2 && hasObject(pe.x, pe.o2) &&
      hubNamesHoldingTip("pr782", hubMapOf(pe.x.h), pe.x.w).join() === "other" && !!peC && peC.state === "ok" && /\(1 on the hub under another name: pr782\)/.test(peC.detail) && !rowOf(peRows, T_UNPUSHED));
    // p1e2: the same, with the Hub's newer sha NOT in the local store: only a fetch can say, so a gated failure whose remedy is the fetch
    const pe2 = mkBehind("r6e2");
    const pe2Rows = pe2.x.rows(), pe2U = rowOf(pe2Rows, T_UNPUSHED);
    check("a holder behind the Hub with the Hub's newer sha NOT local is a gated failure whose remedy is 'run git fetch origin', not 'push' (R6-p1e2)",
      !hasObject(pe2.x, pe2.o2) && !!pe2U && pe2U.state === "fail" && pe2U.gated === true && pe2U.detail.split(" — ")[0] === "pr782" &&
      pe2U.detail.includes(FETCH("other")) && !/push, or confirm the remote/.test(pe2U.detail));
    pe2.x.f("fetch", "-q", "origin");
    check("...and after the fetch the same branch is cleared and named (R6-p1e2-after)", (() => { const r = pe2.x.rows(), c = rowOf(r, T_CLEAN); return !!c && c.state === "ok" && /on the hub under another name: pr782/.test(c.detail) && !rowOf(r, T_UNPUSHED); })());
    // p1f: the only holder is mainline, and the Hub's mainline moves on (the ordinary state of the shared checkout). The same-name warn agrees with the failure row.
    const pf = mkFx("r6f");
    pf.c("m1.txt", "m1\n"); pf.f("push", "-q", "origin", "main"); pf.f("branch", "pinned", "main"); hubAdvance(pf, "main");
    const pfRows = pf.rows(), pfU = rowOf(pfRows, T_UNPUSHED), pfW = rowOf(pfRows, T_AHEAD);
    check("a branch pinned at a mainline the Hub has moved on from is a gated failure saying fetch, and the same-name row for main (its commits held by no Hub-listed commit; origin/main is no evidence since round 16) is a gated failure saying it in the same words (R6-p1f)",
      !!pfU && pfU.state === "fail" && pfU.gated === true && pfU.detail.split(" — ")[0] === "pinned" && pfU.detail.includes(FETCH("main")) && !/push, or confirm the remote/.test(pfU.detail) &&
      !!pfW && pfW.state === "fail" && pfW.gated === true && pfW.detail.startsWith("main (+") && pfW.detail.includes(`main: ${FETCH("main")}`));
    pf.f("fetch", "-q", "origin");
    check("...and after the fetch the pinned branch is cleared and the warn is gone (R6-p1f-after)", (() => { const r = pf.rows(); return rowOf(r, T_CLEAN)?.state === "ok" && !rowOf(r, T_UNPUSHED) && !rowOf(r, T_UNKNOWN); })());
    // a same-named branch whose Hub tip is not fetched and which has NO tracking ref at all: still the fetch remedy, honestly worded (nothing "is behind")
    const pu = mkFx("r6u");
    const puNext = hubAdvance(pu, "main"); execFileSync("git", ["-C", pu.h, "update-ref", "refs/heads/hubonly", puNext]); pu.f("branch", "hubonly", "main");
    const puW = rowOf(pu.rows(), T_UNKNOWN);
    const puA = rowOf(pu.rows(), T_AHEAD);
    check("a same-named branch whose Hub tip is not fetched, has no origin/<name> and carries commits no Hub-listed commit holds is a GATED failure that says fetch (it was an ungated warning while the tracking ref of ANOTHER branch, origin/main, counted as evidence; no tracking ref is, round 12) (R6-unfetched)",
      pu.f("for-each-ref", "refs/remotes/origin/hubonly") === "" && !(puW && /hubonly/.test(puW.detail)) && !!puA && puA.state === "fail" && puA.gated === true && puA.detail.startsWith("hubonly (+") && puA.detail.includes("hubonly: the Hub's hubonly is not fetched here: run git fetch origin, then re-run"));
    // the one-process yes/no (rev-list) cannot read a corrupt listed commit: it answers "unknown", and the answer is then asked of each commit alone,
    // so ONE bad object among the Hub's listed shas neither disables the exemption for the rest nor grants anything
    const pn = mkFx("r6null");
    pn.f("checkout", "-q", "-b", "pr1"); const pnTip = pn.c("p.txt", "p\n"); pn.f("push", "-q", "origin", "pr1:refs/heads/holder");
    const pnBad = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], { cwd: pn.w, input: "garbage, not a commit", encoding: "utf8", env: FX_ENV }).trim();
    const pnMap = new Map([...hubMapOf(pn.h), ["corrupt", pnBad]]), pnOnly = new Map([["corrupt", pnBad]]);
    const pnBoth = hubTipState("pr1", pnMap, pn.w), pnNone = hubTipState("pr1", pnOnly, pn.w);
    check("a corrupt Hub-listed commit makes the one-process answer unknown, and the per-commit fallback still finds the real holder; with only the corrupt one nothing is granted (R6-reach-unknown)",
      localCommits(pn.w, [pnBad]).has(pnBad) && tipReachableFromAny(pn.w, pnTip, [pnBad, pnTip]) === null && pnBoth.holds === true && !pnNone.holds && pnNone.holders.length === 0);
    // the same-name row, ahead of its Hub name AND held by a tracking ref the Hub has moved on from: a fetch before any push
    const ps = mkFx("r6s");
    ps.f("checkout", "-q", "-b", "X"); ps.c("x1.txt", "1\n"); ps.f("push", "-q", "origin", "X"); ps.c("x2.txt", "2\n");
    ps.f("push", "-q", "origin", "X:refs/heads/main"); hubAdvance(ps, "main");
    const psA = rowOf(ps.rows(), T_AHEAD);
    check("a branch one ahead of its Hub name whose tip a lagging origin/main holds is a gated failure that says to fetch first (R6-same-ahead)",
      !!psA && psA.state === "fail" && psA.gated === true && psA.detail.startsWith("X (+1)") && psA.detail.includes(`X: ${FETCH("main")}`));
    ps.f("fetch", "-q", "origin");
    check("...and after the fetch the same-name row is clean, naming X as confirmed (R6-same-ahead-after)", (() => { const a = rowOf(ps.rows(), "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch"); return !!a && a.state === "ok" && /confirmed on the Hub under another branch: X/.test(a.detail); })());
    // (D) every benign warning is carried, not only the first (a .slice(0, 1) survived); past three, a count. Also the missing-map guard.
    const tw = mkFx("r6tw");
    tw.f("branch", "-q", "side-ok"); tw.f("push", "-q", "origin", "side-ok");
    // two DIFFERENT warnings from git itself: an unknown core.fsync component, and the deprecated core.fsyncObjectFiles
    const twRun = withGitConfig([["core.fsync", "foo"], ["core.fsyncObjectFiles", "true"]], () => ({ l: listLocalBranches(tw.w), d: rowOf(tw.rows(), T_CLEAN) }));
    check("two benign warnings printed by git are BOTH named in the row, in git's order, verdict unaffected (R6-two-warnings)",
      twRun.l.ok && twRun.l.warnings.length === 2 && !!twRun.d && twRun.d.state === "ok" &&
      twRun.d.detail.includes("ignoring unknown core.fsync component 'foo'") && twRun.d.detail.includes("core.fsyncObjectFiles is deprecated") &&
      twRun.d.detail.indexOf("core.fsync component") < twRun.d.detail.indexOf("core.fsyncObjectFiles") && !/more\)/.test(twRun.d.detail));
    // more than three: the first three, then a count (handcrafted: git has no cheap fifth warning to print)
    const twFive = rowOf(tw.rows({ listing: { ...twRun.l, warnings: ["warning: w1", "warning: w2", "warning: w3", "warning: w4", "warning: w5"] } }), T_CLEAN).detail;
    check("five benign warnings name the first three and count the rest (R6-five-warnings)", /warning: w1 \| warning: w2 \| warning: w3 \| \+2 more\)/.test(twFive) && !twFive.includes("warning: w4"));
    // (the harness may export these three itself, so the case plants known values, runs withFsync, and puts the originals back)
    const envKeys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"], envOrig = envKeys.map((k) => process.env[k]);
    let envKept;
    try {
      process.env.GIT_CONFIG_COUNT = "0"; process.env.GIT_CONFIG_KEY_0 = "x.planted"; process.env.GIT_CONFIG_VALUE_0 = "planted";
      withFsync(() => 0);
      envKept = process.env.GIT_CONFIG_COUNT === "0" && process.env.GIT_CONFIG_KEY_0 === "x.planted" && process.env.GIT_CONFIG_VALUE_0 === "planted";
    } finally { envKeys.forEach((k, i) => { if (envOrig[i] === undefined) delete process.env[k]; else process.env[k] = envOrig[i]; }); }
    check("withFsync puts the three GIT_CONFIG_* variables back to what they held instead of deleting them (R6-env)", envKept === true);
    const um = mkFx("r6um");
    const umRun = (map) => { try { return { rows: branchSeamRows({ listing: listLocalBranches(um.w), hubBranches: ["main"], hubShaMap: map, ephemeral: [], scratchExcluded: [], mainline: R6M, cwd: um.w }) }; } catch (e) { return { threw: String(e && e.message) }; } };
    const umU = umRun(undefined), umN = umRun(null), umA = umU.rows && rowOf(umU.rows, T_AHEAD);
    check("no Hub sha map does not throw: every same-named branch is a gated failure naming the cause (R6-undefined-map)",
      !umU.threw && !umN.threw && !!umA && umA.state === "fail" && umA.gated === true && umA.detail.startsWith("main (count unreadable)") && /no Hub sha map was passed/.test(umA.detail) && rowOf(umN.rows, T_AHEAD).state === "fail");
    // ══ ROUND 7 ══ The round-6 refuter's fixtures (E, GL2, C1, dU, CG, B2, A8, A9 and the Hub-map shapes), rebuilt beside the rows they must change.
    // Each case builds the lie first (a precondition inside its own check) and then asks the guarded answer; each FAILS on the round-6 file.
    const hubHolds = (fx, sha, name) => { try { execFileSync("git", ["-C", fx.h, "merge-base", "--is-ancestor", sha, `refs/heads/${name}`], { stdio: "ignore" }); return true; } catch { return false; } };
    const reported = (rs, name) => { const u = rowOf(rs, T_UNPUSHED); return !!u && u.state === "fail" && u.gated === true && u.detail.split(" — ")[0] === name && !/squash-landed/.test(JSON.stringify(rs)); };
    const blobOf = (fx, text) => execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: fx.w, input: text, encoding: "utf8" }).trim();
    const treeOf = (fx, entries) => execFileSync("git", ["mktree"], { cwd: fx.w, input: entries.map(([name, blob]) => `100644 blob ${blob}\t${name}\n`).join(""), encoding: "utf8" }).trim();
    // (1) refs/replace. E1: the TIP is replaced by the mainline squash, so every un-guarded read of the tip sees the squash's diff.
    const mkE1 = (name, shallow) => {
      const x = mkFx(name), B = x.f("rev-parse", "HEAD");
      x.c("f.txt", "landed on mainline\n", "S: squash"); const S = x.f("rev-parse", "HEAD"); x.f("push", "-q", "origin", "main");
      x.f("checkout", "-q", "-b", "work", B); const T = x.c("f.txt", "REAL UNPUSHED WORK, nowhere on the Hub\n", "T: real work");
      if (shallow) writeFileSync(join(x.w, ".git", "shallow"), `${B}\n`);
      x.f("replace", T, S);
      return { x, B, S, T };
    };
    for (const shallow of [false, true]) {
      const e = mkE1(shallow ? "r7e1s" : "r7e1", shallow), er = e.x.rows();
      check(`a refs/replace entry that swaps the tip for a mainline squash does not make real unpushed work read squash-landed${shallow ? " (shallow checkout)" : ""} (R7-E1${shallow ? "-shallow" : ""})`,
        e.x.f("for-each-ref", "refs/replace") !== "" && e.x.f("show", "refs/heads/work:f.txt") === "landed on mainline" && (!shallow || e.x.f("rev-parse", "--is-shallow-repository") === "true") &&
        hasLandedByContent("work", R6M, e.x.w) === false && landedByPatchId("work", R6M, e.x.w) === false && reported(er, "work"));
    }
    // E2: the general shape, the replacement is any local commit that carries the squash's change on the fork
    const e2 = mkFx("r7e2"), e2B = e2.f("rev-parse", "HEAD");
    e2.c("other.txt", "mainline moved\n", "M1"); e2.c("f.txt", "landed\n", "S"); e2.f("push", "-q", "origin", "main");
    e2.f("checkout", "-q", "-b", "work", e2B); const e2T = e2.c("f.txt", "REAL UNPUSHED\n", "T");
    const e2Tp = e2.f("commit-tree", treeOf(e2, [["base.txt", e2.f("rev-parse", `${e2B}:base.txt`)], ["f.txt", blobOf(e2, "landed\n")]]), "-p", e2B, "-m", "decoy");
    e2.f("replace", e2T, e2Tp);
    check("a refs/replace entry swapping the tip for a local decoy that carries the squash's change does not clear real unpushed work (R7-E2)",
      landedByPatchId("work", R6M, e2.w) === false && hasLandedByContent("work", R6M, e2.w) === false && reported(e2.rows(), "work") && !hubHolds(e2, e2T, "main"));
    // the path list and the entry reads each go through the replace refs when nothing turns them off (the refuter's MX6 and MX7 survivors)
    const mx6 = mkFx("r7mx6"), mx6B = mx6.f("rev-parse", "HEAD");
    mx6.c("g.txt", "landed\n", "S: g"); mx6.f("push", "-q", "origin", "main");
    mx6.f("checkout", "-q", "-b", "work", mx6B); mx6.put("g.txt", "landed\n"); mx6.put("f.txt", "REAL UNPUSHED\n"); mx6.f("add", "-A"); mx6.f("commit", "-q", "-m", "T");
    const mx6T = mx6.f("rev-parse", "HEAD");
    mx6.f("replace", mx6T, mx6.f("commit-tree", treeOf(mx6, [["base.txt", mx6.f("rev-parse", `${mx6B}:base.txt`)], ["g.txt", mx6.f("rev-parse", "refs/heads/work:g.txt")]]), "-p", mx6B, "-m", "decoy: g only"));
    check("a replacement tip that lists only the landed file cannot hide the real file from the path list (R7-MX6)",
      hasLandedByContent("work", R6M, mx6.w) === false && landedByPatchId("work", R6M, mx6.w) === false && reported(mx6.rows(), "work"));
    const mx7 = mkFx("r7mx7"), mx7B = mx7.f("rev-parse", "HEAD");
    mx7.put("f.txt", "landed f\n"); mx7.put("g.txt", "landed g\n"); mx7.f("add", "-A"); mx7.f("commit", "-q", "-m", "S: f and g"); mx7.f("push", "-q", "origin", "main");
    mx7.f("checkout", "-q", "-b", "work", mx7B); mx7.put("f.txt", "REAL UNPUSHED f\n"); mx7.put("g.txt", "landed g\n"); mx7.f("add", "-A"); mx7.f("commit", "-q", "-m", "T");
    const mx7T = mx7.f("rev-parse", "HEAD");
    mx7.f("replace", mx7T, mx7.f("commit-tree", treeOf(mx7, [["base.txt", mx7.f("rev-parse", `${mx7B}:base.txt`)], ["f.txt", blobOf(mx7, "landed f\n")], ["g.txt", blobOf(mx7, "landed g\n")]]), "-p", mx7B, "-m", "decoy: both landed"));
    check("a replacement tip whose tree equals mainline's cannot make the tree entries read identical (R7-MX7)",
      hasLandedByContent("work", R6M, mx7.w) === false && landedByPatchId("work", R6M, mx7.w) === false && reported(mx7.rows(), "work"));
    // (2) a grafts file. A graft line `S1 Q` gives mainline's S1 the parent Q, a LOCAL copy of the work: the walks then find the work "on mainline".
    for (const shallow of [false, true]) {
      const g = mkFx(shallow ? "r7gls" : "r7gl"), gB = g.f("rev-parse", "HEAD");
      g.c("g.txt", "mainline's own change\n", "S1"); const gS1 = g.f("rev-parse", "HEAD"); g.f("push", "-q", "origin", "main");
      g.f("checkout", "-q", "-b", "work", gB); const gT = g.c("f.txt", "REAL UNPUSHED\n", "T"); g.f("branch", "-D", "main");
      const gQ = g.f("commit-tree", `${gT}^{tree}`, "-p", gB, "-m", "local copy, never pushed");
      const pre = reported(g.rows(), "work");
      if (shallow) writeFileSync(join(g.w, ".git", "shallow"), `${gB}\n`);
      const gf = join(g.w, ".git", "info", "grafts"); writeFileSync(gf, `${gS1} ${gQ}\n`);
      const post = g.rows(), postU = rowOf(post, T_UNPUSHED), landedUnderGraft = [hasLandedByContent("work", R6M, g.w), landedByPatchId("work", R6M, g.w), fileEverMatchedMainline("work", "f.txt", R6M, g.w)];
      unlinkSync(gf);
      check(`a grafts file splicing a local copy of the work into mainline's history turns BOTH landed exemptions off: a gated failure that says so${shallow ? " (shallow checkout)" : ""} (R7-GL2${shallow ? "-shallow" : ""})`,
        pre && landedUnderGraft.every((v) => v === false) && !!postU && postU.state === "fail" && postU.gated === true && postU.detail.split(" — ")[0] === "work" &&
        /alias and squash-landed exemptions OFF: graft file present/.test(postU.detail) && post.filter((r) => r.gated && r.state === "fail").length >= 1 && !/squash-landed, /.test(JSON.stringify(post)));
    }
    // ...and the path list is the other half: a graft that makes work's FIRST commit the parent of a mainline commit moves the merge base up to it,
    // so the diff the byte check walks lists only the later (landed) file and never the earlier, real one. The history walk is not involved here.
    const g2 = mkFx("r7glb"), g2B = g2.f("rev-parse", "HEAD");
    g2.c("g.txt", "landed g\n", "S1"); const g2S1 = g2.f("rev-parse", "HEAD"); g2.f("push", "-q", "origin", "main");
    g2.f("checkout", "-q", "-b", "work", g2B); const g2T1 = g2.c("f.txt", "REAL UNPUSHED f\n", "T1: real work"); g2.c("g.txt", "landed g\n", "T2: the landed file"); g2.f("branch", "-D", "main");
    const g2Pre = reported(g2.rows(), "work"), g2gf = join(g2.w, ".git", "info", "grafts");
    writeFileSync(g2gf, `${g2S1} ${g2T1}\n`);
    const g2Bytes = hasLandedByContent("work", R6M, g2.w), g2Post = g2.rows();
    unlinkSync(g2gf);
    check("a graft that moves the merge base up to the branch's first commit cannot shrink the path list the byte check reads: nothing is cleared under it (R7-GL2-pathlist)",
      g2Pre && g2Bytes === false && (() => { const u = rowOf(g2Post, T_UNPUSHED); return !!u && u.state === "fail" && u.gated === true && u.detail.split(" — ")[0] === "work" && /alias and squash-landed exemptions OFF: graft file present/.test(u.detail); })());
    // a file literally named like pathspec magic: `:(top)x` read as a pathspec is the file x
    const lp = mkFx("r7lp");
    lp.c("x", "x\n"); const lpB = lp.c(":(top)x", "orig\n"); lp.f("push", "-q", "origin", "main");
    lp.f("checkout", "-q", "-b", "real", lpB); lp.c(":(top)x", "REAL change\n");
    lp.f("checkout", "-q", "main"); lp.c("later.txt", "l\n"); lp.f("push", "-q", "origin", "main");
    check("a real change to a file literally named ':(top)x' is reported: its tree entry is read literally, not as the pathspec that names x (R7-litpath)",
      hasLandedByContent("real", R6M, lp.w) === false && reported(lp.rows(), "real"));
    // (3) criss-cross. Mainline and the branch each merged the two sides in a different order, so there are TWO merge bases and `git merge-base` names one.
    // Which one it names depends on the commit dates, so the dates are fixed here (a second apart, oldest first) and the fixture is the same on every run.
    for (const [label, mainFirst, branchFirst] of [["mainline Z+Y, branch Y+Z", "Z", "Y"], ["mainline Y+Z, branch Z+Y", "Y", "Z"]]) {
      let clock = 1700000000;
      const tick = () => { clock += 60; FX_ENV.GIT_AUTHOR_DATE = FX_ENV.GIT_COMMITTER_DATE = `${clock} +0000`; };
      try {
        const c = mkFx(`r7c1-${mainFirst}${branchFirst}`), cc = (file, text, msg) => { tick(); return c.c(file, text, msg); }, cf = (...a) => { tick(); return c.f(...a); };
        cc("f.txt", "v1\n", "O: f=v1"); const cO = c.f("rev-parse", "HEAD"); cf("push", "-q", "origin", "main");
        cf("checkout", "-q", "-b", "p"); cc("f.txt", "v2 FEATURE\n", "X: feature"); const cZ = cc("f.txt", "v1\n", "Z: revert the feature");
        cf("checkout", "-q", "-b", "q", cO); const cY = cc("g.txt", "g\n", "Y: g");
        const sha = { Z: cZ, Y: cY }, other = (k) => (k === "Z" ? "Y" : "Z");
        cf("checkout", "-q", "-b", "mm", sha[mainFirst]); cf("merge", "-q", "--no-edit", "--no-ff", sha[other(mainFirst)]);
        cf("checkout", "-q", "main"); cf("reset", "-q", "--hard", "mm"); cf("push", "-q", "origin", "main");
        cf("checkout", "-q", "-b", "work", sha[branchFirst]); cf("merge", "-q", "--no-edit", "--no-ff", sha[other(branchFirst)]);
        const cN2 = cc("f.txt", "v2 FEATURE\n", "N2: re-apply the reverted feature, LOCAL ONLY"); cf("branch", "-D", "p", "q", "mm");
        const cr = c.rows(), chosen = c.f("merge-base", R6M, "refs/heads/work");
        check(`a pre-fork change mainline reverted, re-applied locally after a criss-cross merge (${label}), is reported: neither landed check walks the other side's old commits (R7-C1 ${mainFirst}${branchFirst})`,
          c.f("merge-base", "--all", R6M, "refs/heads/work").split("\n").length === 2 && chosen === cY && !hubHolds(c, cN2, "main") && c.f("show", `${R6M}:f.txt`) === "v1" &&
          hasLandedByContent("work", R6M, c.w) === false && fileEverMatchedMainline("work", "f.txt", R6M, c.w) === false && landedByPatchId("work", R6M, c.w) === false && reported(cr, "work"));
      } finally { delete FX_ENV.GIT_AUTHOR_DATE; delete FX_ENV.GIT_COMMITTER_DATE; }
    }
    // (4) a same-named branch with a REAL local-only commit, after another lane pushed to the same name and this checkout has not fetched
    const mkU = (name) => {
      const x = mkFx(name);
      x.f("checkout", "-q", "-b", "feat"); x.c("f1.txt", "1\n"); x.f("push", "-q", "-u", "origin", "feat");
      const T = x.c("mine.txt", "REAL local-only work\n", "local only");
      hubAdvance(x, "feat"); // the other lane's push: a different commit on the Hub's feat, not fetched here
      return { x, T };
    };
    const du = mkU("r7u"), duRows = du.x.rows(), duA = rowOf(duRows, T_AHEAD);
    check("a same-named branch with a local-only commit, the Hub having moved the name and nothing fetched, is a GATED failure that says to fetch first (R7-dU)",
      !hubHolds(du.x, du.T, "feat") && du.x.f("rev-list", "--count", "refs/remotes/origin/feat..refs/heads/feat") === "1" && !!duA && duA.state === "fail" && duA.gated === true &&
      duA.detail.startsWith("feat (+2 beyond the Hub's listed commits)") && duA.detail.includes(`feat: ${FETCH("feat")}`) && !rowOf(duRows, T_UNKNOWN));
    du.x.f("fetch", "-q", "origin");
    const duAfter = rowOf(du.x.rows(), T_AHEAD);
    check("...and after the fetch the diverged branch is still a gated failure, now counted against the Hub's own tip (R7-dU-after)", !!duAfter && duAfter.state === "fail" && duAfter.gated === true && duAfter.detail.startsWith("feat (+1)"));
    const dub = mkFx("r7ub");
    dub.f("checkout", "-q", "-b", "feat"); dub.c("f1.txt", "1\n"); dub.f("push", "-q", "-u", "origin", "feat"); hubAdvance(dub, "feat");
    const dubRows = dub.rows(), dubA = rowOf(dubRows, T_AHEAD);
    // ...and the same branch when a Hub-listed commit HOLDS its commits (a pushed branch built on it): the warning with the fetch wording, nothing gated
    const dbh = mkFx("r16bh");
    dbh.f("checkout", "-q", "-b", "feat"); dbh.c("f1.txt", "1\n"); dbh.f("push", "-q", "-u", "origin", "feat");
    dbh.f("checkout", "-q", "-b", "holder", "feat"); dbh.c("h.txt", "h\n"); dbh.f("push", "-q", "origin", "holder"); dbh.f("checkout", "-q", "feat"); hubAdvance(dbh, "feat");
    const dbhRows = dbh.rows(), dbhW = rowOf(dbhRows, T_UNKNOWN);
    check("a same-named branch that is only BEHIND an unfetched Hub tip is a gated failure saying fetch when no Hub-listed commit holds its commits (origin/<name> is no evidence), and keeps the non-gated warning with the fetch wording when one does (R7-dU-behind)",
      dub.f("rev-list", "--count", "refs/remotes/origin/feat..refs/heads/feat") === "0" && !!dubA && dubA.state === "fail" && dubA.gated === true && dubA.detail.startsWith("feat (+1 beyond the Hub's listed commits)") && dubA.detail.includes(`feat: ${FETCH("feat")}`) &&
      !!dbhW && dbhW.state === "warn" && dbhW.gated === false && dbhW.detail.includes(FETCH("feat")) && !dbhRows.some((r) => r.gated && r.state === "fail" && r.what === T_AHEAD));
    // a count git cannot give is unreadable, and unreadable gates too (the local tip has a commit below it whose parent is missing)
    const duu = mkU("r7uu");
    const duuHole = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], { cwd: duu.x.w, encoding: "utf8", env: FX_ENV,
      input: `tree ${duu.x.f("rev-parse", "HEAD^{tree}")}\nparent ${"1234567890".repeat(4)}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nlocal tip with a hole below it\n` }).trim();
    duu.x.f("update-ref", "refs/heads/feat", duuHole);
    const duuA = rowOf(duu.x.rows(), T_AHEAD);
    check("when the commits beyond origin/<name> cannot be counted the same-name comparison is a gated failure 'count unreadable', not the warning (R7-dU-unreadable)",
      !!duuA && duuA.state === "fail" && duuA.gated === true && duuA.detail.startsWith("feat (count unreadable)") && duuA.detail.includes("commits beyond the Hub's listed commits could not be counted"));
    // ...and the Hub-map shapes: a Map with no sha for the name (or an empty one) is the same unanswerable comparison
    const dm = mkU("r7um"), dmReal = hubMapOf(dm.x.h);
    const dmRun = (map) => rowOf(dm.x.rows({ hubShaMap: map }), T_AHEAD);
    const dmMissing = dmRun(new Map([["main", dmReal.get("main")]])), dmEmptyStr = dmRun(new Map([["main", dmReal.get("main")], ["feat", ""]])), dmEmptyMap = dmRun(new Map());
    check("a Hub map with no sha for the branch's name, or an empty sha, or no entries at all, gates the branch with a local-only commit and names the cause (R7-map-missing)",
      [dmMissing, dmEmptyStr, dmEmptyMap].every((a) => !!a && a.state === "fail" && a.gated === true && /^feat \(\+\d+ beyond the Hub's listed commits\)/.test(a.detail) && a.detail.includes("the Hub sha map has no sha for feat")) &&
      !dm.x.rows({ hubShaMap: new Map() }).some((r) => r.what === T_UNKNOWN && /feat/.test(r.detail)));
    const dmShape = (map) => { const a = rowOf(dm.x.rows({ hubShaMap: map }), T_AHEAD); return a ? a.detail : ""; };
    check("the Hub-map wording says what arrived: nothing, an empty object, or an object that is not a Map (R7-map-wording)",
      /no Hub sha map was passed/.test(dmShape(undefined)) && /no Hub sha map was passed/.test(dmShape(null)) && /an empty Hub sha map was passed/.test(dmShape({})) &&
      !/no Hub sha map was passed/.test(dmShape({})) && /the Hub sha map is not a Map/.test(dmShape({ main: dmReal.get("main") })));
    // A loose object git wrote is read-only (0444): writing over one fails for any user but root, so a planted object replaces it by unlink-then-write (the unlink needs only the
    // directory's write permission; an object that was not there yet is the common case and is simply created).
    const writeLooseObject = (work, sha, rawObject) => {
      const dir = join(work, ".git", "objects", sha.slice(0, 2)), file = join(dir, sha.slice(2));
      mkdirSync(dir, { recursive: true });
      try { unlinkSync(file); } catch (e) { if (!(e && (e.code === "ENOENT" || e.code === "ENOTDIR"))) throw e; }
      writeFileSync(file, deflateSync(rawObject));
    };
    // (5) a forged objects/info/commit-graph: a cache git trusts without checking, here giving a Hub-listed commit the unpushed tip as its parent
    // Git writes objects/info/commit-graph read-only (0444), and a process that is not root cannot open it for writing: the forged bytes go to a sibling temp file that gets the
    // original's mode, and a rename replaces the original, which is how git itself replaces the file and needs only the directory's write permission. Mode, inode and bytes are read
    // from ONE open descriptor, so no stat of the path precedes its use. Returns { mode, ino } of the file it replaced (CI ran as a non-root user; this sandbox's root user hid it).
    const forgeCommitGraph = (path, child, newParent) => {
      const fd = openSync(path, "r");
      let b, mode, ino;
      try { const st = fstatSync(fd); mode = st.mode & 0o777; ino = st.ino; b = readFileSync(fd); } finally { closeSync(fd); }
      if (b.toString("latin1", 0, 4) !== "CGPH") throw new Error("not a commit-graph file");
      const chunks = {};
      for (let i = 0; i <= b[6]; i++) chunks[b.toString("latin1", 8 + 12 * i, 12 + 12 * i)] = Number(b.readBigUInt64BE(12 + 12 * i));
      const n = b.readUInt32BE(chunks.OIDF + 255 * 4), oids = [];
      for (let i = 0; i < n; i++) oids.push(b.toString("hex", chunks.OIDL + 20 * i, chunks.OIDL + 20 * (i + 1)));
      const ci = oids.indexOf(child), pi = oids.indexOf(newParent), rec = (i) => chunks.CDAT + 36 * i, gen = (i) => b.readBigUInt64BE(rec(i) + 28);
      b.writeUInt32BE(pi, rec(ci) + 20);
      const gp = gen(pi) >> 34n, gc = gen(ci) >> 34n, date = gen(ci) & ((1n << 34n) - 1n), ng = gc > gp + 1n ? gc : gp + 1n;
      b.writeBigUInt64BE((ng << 34n) | date, rec(ci) + 28);
      createHash("sha1").update(b.subarray(0, b.length - 20)).digest().copy(b, b.length - 20);
      const tmp = `${path}.forged-${process.pid}`;
      writeFileSync(tmp, b, { mode }); chmodSync(tmp, mode); renameSync(tmp, path);
      return { mode, ino };
    };
    const cg = mkFx("r7cg"), cgB = cg.f("rev-parse", "HEAD");
    cg.f("checkout", "-q", "-b", "oth"); const cgO = cg.c("o.txt", "o\n"); cg.f("push", "-q", "origin", "oth:refs/heads/other");
    cg.f("checkout", "-q", "-b", "mine", cgB); const cgT = cg.c("w.txt", "REAL unpushed\n"); cg.f("branch", "-D", "oth");
    execFileSync("git", ["-c", "commitGraph.generationVersion=1", "commit-graph", "write", "--stdin-commits", "--no-progress"], { cwd: cg.w, input: `${cgO}\n${cgT}\n${cgB}\n`, env: FX_ENV, stdio: ["pipe", "ignore", "ignore"] });
    const cgFile = join(cg.w, ".git", "objects", "info", "commit-graph"), cgHonest = cg.f("rev-list", cgT, "--not", cgO) !== "";
    const cgForged = forgeCommitGraph(cgFile, cgO, cgT), cgAfter = statSync(cgFile);
    const cgLie = cg.f("rev-list", cgT, "--not", cgO) === "", cgTruthOff = cg.f("-c", "core.commitGraph=false", "rev-list", cgT, "--not", cgO) !== "";
    const cgRows = cg.rows();
    check("a forged commit-graph that makes a Hub-listed commit the child of the unpushed tip does not make the Hub hold it: every ancestry answer is read from the objects (R7-CG)",
      cgHonest && cgLie && cgTruthOff && !hubHolds(cg, cgT, "other") && hubTipState("mine", hubMapOf(cg.h), cg.w).holds === false && isOnHubBySha("mine", hubMapOf(cg.h), cg.w) === false && reported(cgRows, "mine"));
    // The forge must leave the file exactly as read-only as git made it (and git does make it read-only): a forge that wrote in place, or chmodded it writable, only works as root.
    // A directory listing that proves "no temp file is left" must have READ the directory: it has to contain the commit-graph itself, or an empty read would pass.
    const noTempLeft = (names, must) => names.includes(must) && names.every((n) => !n.includes(".forged-"));
    const cgDirEntries = readdirSync(dirname(cgFile));
    check("forging the commit-graph keeps the mode git gave the file (read-only) and REPLACES the file (a new inode, no temp file left), where an in-place write needs a user who may write it (R11-CG-mode)",
      (cgForged.mode & 0o222) === 0 && (cgAfter.mode & 0o777) === cgForged.mode && cgAfter.ino !== cgForged.ino && noTempLeft(cgDirEntries, "commit-graph") && noTempLeft(["commit-graph"], "commit-graph") && !noTempLeft([], "commit-graph") && !noTempLeft(["commit-graph", "commit-graph.forged-1"], "commit-graph") && !noTempLeft(["other"], "commit-graph"));
    // (6) user configuration must not change the answer: diff.ignoreSubmodules=all hides a gitlink bump from the porcelain path list and patch
    const sb = mkFx("r7sb"), sbS1 = "1".repeat(40), sbS3 = "3".repeat(40);
    sb.f("update-index", "--add", "--cacheinfo", `160000,${sbS1},sub`); sb.f("commit", "-q", "-m", "sub@s1"); const sbB = sb.f("rev-parse", "HEAD"); sb.f("push", "-q", "origin", "main");
    sb.f("checkout", "-q", "-b", "work", sbB); sb.f("update-index", "--cacheinfo", `160000,${sbS3},sub`); sb.put("f.txt", "landed\n"); sb.f("add", "f.txt"); sb.f("commit", "-q", "-m", "bump sub to s3 (pushed nowhere) + f");
    sb.f("checkout", "-q", "main"); sb.c("f.txt", "landed\n", "squash of f only"); sb.f("push", "-q", "origin", "main");
    sb.f("config", "diff.ignoreSubmodules", "all");
    check("a branch that bumps a submodule pointer nobody pushed AND changes a landed file is reported although diff.ignoreSubmodules=all hides the bump from `git diff` (R7-B2)",
      sb.f("diff", "--name-only", `${R6M}...refs/heads/work`) === "f.txt" && hasLandedByContent("work", R6M, sb.w) === false && landedByPatchId("work", R6M, sb.w) === false && reported(sb.rows(), "work"));
    const sc = mkFx("r7sc"), scB = sc.f("rev-parse", "HEAD");
    sc.c("f.txt", "landed\n", "S"); sc.f("push", "-q", "origin", "main");
    sc.f("checkout", "-q", "-b", "work", scB); sc.c("f.txt", "landed\n", "orig"); sc.f("checkout", "-q", "main"); sc.c("g.txt", "g\n"); sc.f("push", "-q", "origin", "main");
    const scBefore = landedByPatchId("work", R6M, sc.w);
    sc.f("config", "color.diff", "always"); sc.f("config", "diff.external", "false");
    check("color.diff=always and diff.external=false change nothing: a landed branch still clears by hunks (R7-B2-config)", scBefore === true && landedByPatchId("work", R6M, sc.w) === true);
    // (7) a hand-written loose object at a Hub-listed sha: git does not verify an object when it reads it
    const fo = mkFx("r7fo");
    fo.f("checkout", "-q", "-b", "oth"); fo.c("o.txt", "o\n"); fo.f("push", "-q", "origin", "oth:refs/heads/other");
    fo.f("checkout", "-q", "-b", "mine", "main"); const foT = fo.c("w.txt", "real unpushed\n"); fo.f("branch", "-D", "oth");
    const foHub = hubAdvance(fo, "other");
    const foBody = Buffer.from(`tree ${fo.f("rev-parse", `${foT}^{tree}`)}\nparent ${foT}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nforged\n`);
    const foObj = Buffer.concat([Buffer.from(`commit ${foBody.length}\0`), foBody]);
    writeLooseObject(fo.w, foHub, foObj);
    const foRows = fo.rows();
    check("a loose object forged at a Hub-listed sha (its content does not hash to its name) is not a holder: git believes it on read, the check re-hashes the listed commits (R7-forged-object)",
      createHash("sha1").update(foObj).digest("hex") !== foHub && fo.f("cat-file", "-t", foHub) === "commit" && !hubHolds(fo, foT, "other") && !localCommits(fo.w, [foHub]).has(foHub) &&
      hubTipState("mine", hubMapOf(fo.h), fo.w).holds === false && reported(foRows, "mine"));
    // (8) the one-process yes/no and the per-commit names must agree. Round 7: a listed commit with a missing parent BESIDE the tip held the tip
    // by the one-process answer and not by merge-base --is-ancestor. Round 8 verifies the chain the answer rests on (chainIsReal), which reads every
    // parent of the holder, so the hole now fails BOTH closed; a sound holder says yes in both.
    const an = mkFx("r7an");
    an.f("checkout", "-q", "-b", "mine"); const anT = an.c("w.txt", "w\n");
    const anHole = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], { cwd: an.w, encoding: "utf8", env: FX_ENV,
      input: `tree ${an.f("rev-parse", "HEAD^{tree}")}\nparent ${"1234567890".repeat(4)}\nparent ${anT}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nhole beside the tip\n` }).trim();
    const anMap = new Map([["h", anHole]]);
    const anKid = an.c("kid.txt", "k\n"), anKidMap = new Map([["h2", anKid]]);
    an.f("checkout", "-q", "-b", "mine2", anT);
    check("the yes/no and the names ask the same question: a holder with an unreadable parent beside the tip fails closed in both, a sound holder says yes in both (R7-names-agree)",
      tipReachableFromAny(an.w, anT, [anHole]) === false && hubTipState("mine", anMap, an.w).holds === false && hubNamesHoldingTip("mine", anMap, an.w).length === 0 &&
      hubTipState("mine2", anKidMap, an.w).holds === true && hubNamesHoldingTip("mine2", anKidMap, an.w).join() === "h2");
    // (9) read-only: `git status` refreshes the index (and takes its lock) unless told not to
    const ro = mkFx("r7ro");
    ro.c("t.txt", "same bytes\n"); writeFileSync(join(ro.w, "t.txt"), "same bytes\n"); utimesSync(join(ro.w, "t.txt"), new Date(Date.now() - 86400000), new Date(Date.now() - 3600000));
    const roIdx = join(ro.w, ".git", "index"), roSum = () => createHash("sha1").update(readFileSync(roIdx)).digest("hex"), roBefore = roSum();
    gitIn(ro.w)("status", "--porcelain");
    const roGuarded = roSum();
    execFileSync("git", ["status", "--porcelain"], { cwd: ro.w, stdio: "ignore", env: FX_ENV });
    check("the check's own `git status` leaves the index byte-identical, where a plain `git status` rewrites it (R7-readonly)", roGuarded === roBefore && roSum() !== roBefore);
    // (10) one place starts git: the environment guards live in gitEnv, and no other direct spawn of git reads objects
    const prodSrc = readFileSync(fileURLToPath(import.meta.url), "utf8"), prodText = prodSrc.slice(0, prodSrc.indexOf("\nfunction selfTest()"));
    // quote-agnostic (round-7 refute: a single-quoted stray was not found): any quote, execFile / spawn / exec forms, only the two allowed argument lists pass
    const strayGit = (text) => [...text.matchAll(/\b(?:execFileSync|spawnSync|execFile|spawn)\(\s*(["'`])git\1\s*,\s*(\[[^\]]{0,60})?/g)].map((m) => m[2] || "")
      .filter((a) => !/^\[\s*["'`]-c["'`]\s*,\s*["'`]core\.commitGraph=false["'`]\s*,\s*["'`]-C["'`]/.test(a))
      .concat([...text.matchAll(/\b(?:exec|execSync)\(\s*(["'`])\s*git\b/g)].map((m) => m[0]));
    const stray = strayGit(prodText);
    check("no git is started outside gitRun (the Hub listing included since round 9), and gitEnv forces replace objects off and optional locks off whatever the caller passes (R7-spawns)",
      stray.length === 0 && gitEnv({ GIT_NO_REPLACE_OBJECTS: "0", GIT_OPTIONAL_LOCKS: "1", KEEP: "x" }).GIT_NO_REPLACE_OBJECTS === "1" &&
      gitEnv({ GIT_OPTIONAL_LOCKS: "1" }).GIT_OPTIONAL_LOCKS === "0" && gitEnv({ KEEP: "x" }).KEEP === "x");
    // ══ ROUND 8 ══ The round-7 refuter's fixtures (E2E-ls, SH1, SH3, SNb, SNc, the env and object attacks, AP, the attribute scenarios), rebuilt beside
    // the rows they must change. Each case builds the lie first (a precondition inside its own check) and then asks the guarded answer.
    const withEnvVars = (vars, fn) => {
      const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
      for (const [k, v] of Object.entries(vars)) { if (v === null) delete process.env[k]; else process.env[k] = v; } // (null: unset)
      try { return fn(); } finally { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    };
    const plantLoose = (fx, sha, body) => { // a loose object written under a name it does not hash to (git does not verify on read)
      writeLooseObject(fx.w, sha, Buffer.concat([Buffer.from(`commit ${body.length}\0`), body]));
    };
    const laneOf = (fx, name, cloneArgs = []) => { // a hermetic clone of the fixture's hub, with the seam rows for it
      const dir = join(root, `${name}-lane`);
      execFileSync("git", ["clone", "-q", ...cloneArgs, `file://${fx.h}`, dir], { env: FX_ENV, stdio: "ignore" });
      const lf = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: FX_ENV }).trim();
      lf("config", "commit.gpgsign", "false");
      const lrows = () => { const m = hubMapOf(fx.h); return branchSeamRows({ listing: listLocalBranches(dir), hubBranches: [...m.keys()], hubShaMap: m, ephemeral: [], scratchExcluded: [], mainline: R6M, cwd: dir }); };
      return { dir, f: lf, rows: lrows };
    };
    // (1) the Hub URL is what git will really use. E2E-ls: `url.<mirror>.insteadOf <Hub URL>` served the listing, took the push, and passed the origin row
    const lsx = mkFx("r8ls"), lsMirror = join(root, "r8ls-mirror.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", lsMirror]);
    lsx.f("config", "remote.origin.url", HUB); lsx.f("push", "-q", lsMirror, "main");
    const lsPlain = { problem: hubUrlProblem(lsx.w), row: originRow(lsx.w) };
    lsx.f("config", `url.${lsMirror}.insteadOf`, HUB);
    const lsRedirected = { problem: hubUrlProblem(lsx.w), row: originRow(lsx.w) };
    check("a url.<mirror>.insteadOf for the Hub URL is a failing Hub-URL problem and a failing origin row that name the mirror, where an unrewritten repository has neither (R8-ls-url)",
      lsPlain.problem === "" && lsPlain.row.state === "ok" && lsRedirected.problem.includes("rewrites the Hub URL") && lsRedirected.problem.includes(lsMirror) &&
      lsRedirected.row.state === "fail" && lsRedirected.row.detail.includes(lsMirror) && /remote\.origin\.url is https:\/\/github\.com\/.*rewritten by url\.<base>\.insteadOf/.test(lsRedirected.row.detail));
    const lsv = mkFx("r8ls2"), lsVariant = (url, extra = []) => { lsv.f("config", "remote.origin.url", url); for (const [k, v] of extra) lsv.f("config", k, v); const r = originRow(lsv.w).state; for (const [k] of extra) lsv.f("config", "--unset", k); return r; };
    check("the origin row is an exact test: every spelling of the Hub passes, and a mirror path, another host, a longer repository name or the Hub's name inside another URL fails (R8-ls-origin)",
      ["https://github.com/DanFashauer/SignalGrid-Review-Hub.git", "https://github.com/DanFashauer/SignalGrid-Review-Hub", "https://github.com/danfashauer/signalgrid-review-hub/", "git@github.com:DanFashauer/SignalGrid-Review-Hub.git", "ssh://git@github.com/DanFashauer/SignalGrid-Review-Hub.git"].every((u) => lsVariant(u) === "ok") &&
      [`${lsMirror}/DanFashauer/SignalGrid-Review-Hub.git`, "https://example.org/DanFashauer/SignalGrid-Review-Hub.git", "https://github.com/DanFashauer/SignalGrid-Review-Hub-fork.git", "https://github.com/evil/DanFashauer/SignalGrid-Review-Hub.git"].every((u) => lsVariant(u) === "fail") &&
      lsVariant("https://github.com/DanFashauer/SignalGrid-Review-Hub.git", [["remote.origin.pushurl", lsMirror]]) === "fail");
    // the whole script, end to end, in a copy of the fixture (the refuter's run: file protocol only, an unreachable proxy for anything else)
    mkdirSync(join(lsx.w, "scripts"), { recursive: true });
    writeFileSync(join(lsx.w, "scripts", "loop-state.mjs"), prodSrc);
    const lsRun = spawnSync(process.execPath, [join(lsx.w, "scripts", "loop-state.mjs")], { cwd: lsx.w, encoding: "utf8", env: { ...process.env, GIT_ALLOW_PROTOCOL: "file", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9" }, timeout: 120000 });
    const lsOut = String(lsRun.stdout).replace(/\x1b\[[0-9;]*m/g, "");
    check("the whole check, run in a repository whose Hub URL is rewritten to a local mirror, exits 1 with a failing Hub-URL row and a failing origin row, and never says the branches are present on the Review Hub (R8-ls-e2e)",
      lsRun.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL/.test(lsOut) && /✗ origin points at the Review Hub/.test(lsOut) && !/all present on the Review Hub/.test(lsOut));
    // (2) shallow boundaries. SH1: a .git/shallow line naming the local re-apply commit hides its real parent from `<tip>..mainline`
    const sh1 = mkFx("r8sh1");
    const sh1O = sh1.c("f.txt", "v1\n", "O"); sh1.f("push", "-q", "origin", "main");
    sh1.f("checkout", "-q", "-b", "kside", sh1O); sh1.c("k.txt", "k\n", "K: side"); sh1.f("push", "-q", "origin", "kside");
    sh1.f("checkout", "-q", "main"); sh1.c("f.txt", "v2 FEATURE\n", "X: feature"); const sh1Z = sh1.c("f.txt", "v1\n", "Z: revert the feature");
    sh1.f("merge", "-q", "--no-edit", "--no-ff", "kside"); sh1.f("push", "-q", "origin", "main");
    sh1.f("checkout", "-q", "-b", "work", sh1Z); const sh1T1 = sh1.c("f.txt", "v2 FEATURE\n", "T1: LOCAL re-apply of the reverted feature");
    sh1.f("merge", "-q", "--no-edit", "--no-ff", "kside"); sh1.f("branch", "-D", "kside");
    const sh1Pre = reported(sh1.rows(), "work");
    writeFileSync(join(sh1.w, ".git", "shallow"), `${sh1T1}\n`);
    const sh1Walk = sh1.f("log", "--format=%s", `refs/heads/work..${R6M}`).split("\n"), sh1B = shallowBounds(sh1.w, "refs/heads/work", R6M);
    check("a hand-written .git/shallow line naming the branch's own commit does not hide the real ancestry from the fork walk: the real parent is excluded and the work stays reported (R8-SH1)",
      sh1Pre && sh1Walk.includes("X: feature") && sh1B.off === "" && sh1B.exclude.includes(sh1Z) &&
      hasLandedByContent("work", R6M, sh1.w) === false && landedByPatchId("work", R6M, sh1.w) === false && reported(sh1.rows(), "work"));
    // SH3: the same, with ordinary commands only: a full clone, a local re-apply on a Hub PR branch, a merge of another Hub branch, then a depth-1 refresh of the PR
    const sh3 = mkFx("r8sh3");
    const sh3O = sh3.c("f.txt", "v1\n", "O"); sh3.f("push", "-q", "origin", "main");
    sh3.f("checkout", "-q", "-b", "kside", sh3O); sh3.c("k.txt", "k\n", "K: side"); sh3.f("push", "-q", "origin", "kside");
    sh3.f("checkout", "-q", "main"); sh3.c("f.txt", "v2 FEATURE\n", "X: feature"); const sh3Z = sh3.c("f.txt", "v1\n", "Z: revert the feature"); sh3.f("push", "-q", "origin", "main");
    sh3.f("checkout", "-q", "-b", "prb", sh3Z); const sh3P = sh3.c("doc.txt", "a PR\n", "P: the PR commit"); sh3.f("push", "-q", "origin", "prb");
    sh3.f("checkout", "-q", "main"); sh3.f("merge", "-q", "--no-edit", "--no-ff", "kside"); sh3.c("doc.txt", "a PR\n", "squash of P"); sh3.f("push", "-q", "origin", "main");
    const l3 = laneOf(sh3, "r8sh3");
    l3.f("checkout", "-q", "-b", "work", "origin/prb"); writeFileSync(join(l3.dir, "f.txt"), "v2 FEATURE\n"); l3.f("add", "-A"); l3.f("commit", "-q", "-m", "T1: LOCAL re-apply of the reverted feature");
    l3.f("merge", "-q", "--no-edit", "--no-ff", "origin/kside");
    const l3Pre = hasLandedByContent("work", R6M, l3.dir) === false && reported(l3.rows(), "work");
    l3.f("fetch", "-q", "--depth=1", "origin", "prb");
    check("a depth-1 refresh of a Hub PR branch under the lane's own work does not clear it: the PR tip becomes a boundary, its real parent is excluded from both walks (R8-SH3)",
      l3Pre && readFileSync(join(l3.dir, ".git", "shallow"), "utf8").trim() === sh3P && shallowBounds(l3.dir, "refs/heads/work", R6M).exclude.includes(sh3Z) &&
      hasLandedByContent("work", R6M, l3.dir) === false && landedByPatchId("work", R6M, l3.dir) === false && reported(l3.rows(), "work"));
    // ...and a boundary whose real parent is NOT in the store and that mainline does not reach cannot be bounded: the exemptions are off for that branch, and the
    // row says so. Mainline made the feature together with the PR's two commits (X*) and reverted all of it (Z*); the lane's branch is the PR tip (a depth-1 boundary,
    // its first commit Q absent) merged with kside, plus the local re-apply of the feature. Walked from the tip, X* looks like a post-fork landing of exactly the
    // branch's hunks AND of every file it changes, so both landed checks clear it unless the exemptions are off.
    const so = mkFx("r8so");
    const soO = so.c("f.txt", "v1\n", "O"); so.f("push", "-q", "origin", "main");
    so.f("checkout", "-q", "-b", "kside", soO); so.c("k.txt", "k\n", "K: side"); so.f("push", "-q", "origin", "kside");
    so.f("checkout", "-q", "main"); so.put("f.txt", "v2 FEATURE\n"); so.put("q.txt", "q\n"); so.put("doc.txt", "a PR\n"); so.f("add", "-A"); so.f("commit", "-q", "-m", "X*: the feature and the PR");
    so.f("rm", "-q", "q.txt", "doc.txt"); so.put("f.txt", "v1\n"); so.f("add", "-A"); so.f("commit", "-q", "-m", "Z*: revert all of it"); const soZ = so.f("rev-parse", "HEAD");
    so.f("merge", "-q", "--no-edit", "--no-ff", "kside"); so.f("push", "-q", "origin", "main");
    so.f("checkout", "-q", "-b", "prb", soZ); so.c("q.txt", "q\n", "Q: the PR's first commit"); so.c("doc.txt", "a PR\n", "P: the PR tip"); so.f("push", "-q", "origin", "prb");
    const lo = laneOf(so, "r8so", ["--depth=6", "-b", "main"]);
    lo.f("fetch", "-q", "--depth=1", "origin", "refs/heads/prb:refs/remotes/origin/prb");
    lo.f("update-ref", "refs/remotes/origin/kside", execFileSync("git", ["-C", so.h, "rev-parse", "refs/heads/kside"], { encoding: "utf8" }).trim()); // K is in mainline's history, so it is in the store
    lo.f("checkout", "-q", "-b", "work", "origin/prb");
    lo.f("merge", "-q", "--no-edit", "--no-ff", "--allow-unrelated-histories", "origin/kside"); // the PR tip is cut off from everything: its merge with kside is what gives the branch a visible common ancestor
    writeFileSync(join(lo.dir, "f.txt"), "v2 FEATURE\n"); lo.f("add", "-A"); lo.f("commit", "-q", "-m", "T1: LOCAL re-apply of the reverted feature");
    const loB = shallowBounds(lo.dir, "refs/heads/work", R6M), loRow = rowOf(lo.rows(), T_UNPUSHED);
    check("a branch on a shallow boundary whose real parent is not in the store and that mainline does not reach has its landed exemptions OFF, and the row names the branch and why (R8-SH-opaque)",
      lo.f("rev-parse", "--is-shallow-repository") === "true" && lo.f("log", "--format=%s", `refs/heads/work..${R6M}`).split("\n").includes("X*: the feature and the PR") &&
      loB.off !== "" && hasLandedByContent("work", R6M, lo.dir) === false && landedByPatchId("work", R6M, lo.dir) === false &&
      !!loRow && loRow.state === "fail" && loRow.gated === true && loRow.detail.split(" — ")[0] === "work" && /squash-landed exemptions OFF for work: the history below the shallow boundary/.test(loRow.detail));
    // ...while the ordinary shallow clone keeps working: a squash-landed branch whose only boundary is SHARED with mainline still clears (the exemption is not given up for every shallow checkout)
    const sc2 = mkFx("r8sc");
    sc2.c("a.txt", "base\n"); sc2.f("push", "-q", "origin", "main");
    sc2.f("checkout", "-q", "-b", "feat"); sc2.c("feat.txt", "the feature\n", "feat"); sc2.f("checkout", "-q", "main");
    sc2.c("feat.txt", "the feature\n", "squash of feat"); sc2.c("later.txt", "later\n", "a later change"); sc2.f("push", "-q", "origin", "main");
    const ls2 = laneOf(sc2, "r8sc", ["--depth=3", "-b", "main"]);
    ls2.f("fetch", "-q", sc2.w, "refs/heads/feat:refs/heads/feat");
    const ls2B = shallowBounds(ls2.dir, "refs/heads/feat", R6M);
    check("a squash-landed branch in an ordinary shallow clone, whose boundary mainline shares, still clears by bytes (R8-SH-shared)",
      ls2.f("rev-parse", "--is-shallow-repository") === "true" && ls2B.off === "" && hasLandedByContent("feat", R6M, ls2.dir) === true);
    // (3a) the count is of commits the Hub is NOT known to hold: a.1 was pushed (origin/feat is there, behind), a.2 sits on a Hub branch `hold` pushed by URL
    // (no tracking ref), a.3 is held by nothing, and the Hub has since moved feat. Counted against origin/feat alone that is +2; it is +1.
    const bc = mkFx("r8bc");
    bc.f("checkout", "-q", "-b", "feat"); bc.c("a1.txt", "1\n"); bc.f("push", "-q", "origin", "feat"); const bcA2 = bc.c("a2.txt", "2\n"); bc.f("push", "-q", bc.h, "feat:refs/heads/hold");
    bc.c("a3.txt", "3\n", "held by nothing"); hubAdvance(bc, "feat");
    const bcA = rowOf(bc.rows(), T_AHEAD);
    check("the 'beyond' count leaves out commits a Hub-listed commit already holds: +1, not the +2 a count against origin/<name> alone gives (R8-beyond-count)",
      bc.f("rev-list", "--count", "refs/remotes/origin/feat..refs/heads/feat") === "2" && hubHolds(bc, bcA2, "hold") && !!bcA && bcA.state === "fail" && bcA.detail.startsWith("feat (+1 beyond the Hub's listed commits)"));
    // (3) SNb: a single-branch clone's refspec never gives origin/feat, and another lane pushes feat
    const nb = mkFx("r8nb");
    nb.f("config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main");
    nb.f("checkout", "-q", "-b", "feat"); nb.c("f1.txt", "1\n"); nb.f("push", "-q", "origin", "feat"); const nbT = nb.c("mine.txt", "REAL local-only\n", "local only");
    const nbLane = join(root, "r8nb-lane"); execFileSync("git", ["clone", "-q", "-b", "feat", nb.h, nbLane], { env: FX_ENV, stdio: "ignore" });
    writeFileSync(join(nbLane, "t.txt"), "t\n"); execFileSync("git", ["-C", nbLane, "add", "-A"], { env: FX_ENV }); execFileSync("git", ["-C", nbLane, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "other lane"], { env: FX_ENV });
    execFileSync("git", ["-C", nbLane, "push", "-q", "origin", "feat"], { env: FX_ENV, stdio: "ignore" });
    const nbRows = nb.rows(), nbA = rowOf(nbRows, T_AHEAD);
    check("a same-named branch with a local-only commit, in a clone with no origin/<name> at all, is a GATED failure counted against the Hub's listed commits, with the fetch remedy (R8-SNb)",
      nb.f("for-each-ref", "refs/remotes/origin/feat") === "" && !hubHolds(nb, nbT, "feat") && !!nbA && nbA.state === "fail" && nbA.gated === true &&
      /^feat \(\+\d+ beyond the Hub's listed commits\)/.test(nbA.detail) && nbA.detail.includes(`feat: ${unfetchedHint("feat")}`) && !rowOf(nbRows, T_UNKNOWN));
    // (4) the environment: GIT_TEST_COMMIT_GRAPH=1 forces the commit-graph back on over core.commitGraph=false, GIT_OBJECT_DIRECTORY / GIT_ALTERNATE_OBJECT_DIRECTORIES re-point the reads
    const cgLiesUnderEnv = withEnvVars({ GIT_TEST_COMMIT_GRAPH: "1" }, () => execFileSync("git", ["-c", "core.commitGraph=false", "rev-list", cgT, "--not", cgO], { cwd: cg.w, encoding: "utf8" }).trim() === "");
    const cgUnderEnv = withEnvVars({ GIT_TEST_COMMIT_GRAPH: "1" }, () => ({ holds: hubTipState("mine", hubMapOf(cg.h), cg.w).holds, rows: cg.rows() }));
    const scrubbed = withEnvVars({ GIT_TEST_ANYTHING: "1", GIT_OBJECT_DIRECTORY: join(root, "no-objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, "no-alt"), GIT_AUTHOR_NAME: "kept" }, () => gitEnv({}));
    check("with GIT_TEST_COMMIT_GRAPH=1 the forged commit-graph is still not read, and GIT_TEST_*, GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES never reach a git this file starts (R8-env)",
      cgLiesUnderEnv && cgUnderEnv.holds === false && reported(cgUnderEnv.rows, "mine") && scrubbed.GIT_TEST_ANYTHING === undefined && scrubbed.GIT_OBJECT_DIRECTORY === undefined &&
      scrubbed.GIT_ALTERNATE_OBJECT_DIRECTORIES === undefined && scrubbed.GIT_AUTHOR_NAME === "kept" && scrubbed.GIT_NO_REPLACE_OBJECTS === "1");
    // (5) the REAL Hub commit over a FORGED parent: the listed commit hashes to its name, the chain below it does not
    const ob = mkFx("r8ob");
    ob.f("checkout", "-q", "-b", "oth"); ob.c("o.txt", "o\n"); ob.f("push", "-q", "origin", "oth:refs/heads/other");
    ob.f("checkout", "-q", "-b", "mine", "main"); const obT = ob.c("w.txt", "REAL unpushed\n"); ob.f("branch", "-D", "oth");
    const obHg = (...a) => execFileSync("git", ["-C", ob.h, ...a], { encoding: "utf8", env: FX_ENV }).trim(), obO = obHg("rev-parse", "refs/heads/other");
    const obP2 = obHg("commit-tree", `${obO}^{tree}`, "-p", obO, "-m", "hub P2"), obH2 = obHg("commit-tree", `${obO}^{tree}`, "-p", obP2, "-m", "hub H2"); obHg("update-ref", "refs/heads/other", obH2);
    const obPlanted = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: ob.w, input: execFileSync("git", ["-C", ob.h, "cat-file", "commit", obH2]), encoding: "utf8", env: FX_ENV }).trim();
    plantLoose(ob, obP2, Buffer.from(`tree ${ob.f("rev-parse", `${obT}^{tree}`)}\nparent ${obT}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nforged P2\n`));
    const obMap = hubMapOf(ob.h);
    check("the real Hub commit planted over a forged parent (whose content names the tip) is not a holder: the whole chain from the tip to the holder is re-hashed, not only its end (R8-chain)",
      obPlanted === obH2 && localCommits(ob.w, [obH2]).has(obH2) && !hubHolds(ob, obT, "other") && tipReachableFromAny(ob.w, obT, [obH2]) === false &&
      hubTipState("mine", obMap, ob.w).holds === false && hubNamesHoldingTip("mine", obMap, ob.w).length === 0 && reported(ob.rows(), "mine"));
    // (6) detached HEAD: commits made on a detached HEAD are in no branch
    const dh = mkFx("r8dh");
    dh.f("checkout", "-q", "--detach"); const dhT = dh.c("d.txt", "REAL work on a detached HEAD\n", "detached work");
    const dhRows = dh.rows(), dhRow = rowOf(dhRows, "Detached HEAD work not on the Review Hub");
    check("work committed on a detached HEAD that no local branch or Hub-listed commit holds is a GATED failure naming HEAD and the count (R8-detached)",
      dh.f("rev-parse", "HEAD") === dhT && dh.f("branch", "--contains", dhT).startsWith("* (HEAD detached") && !!dhRow && dhRow.state === "fail" && dhRow.gated === true &&
      dhRow.detail.startsWith(`HEAD (detached at ${dhT.slice(0, 12)}) carries 1 commit(s)`));
    dh.f("branch", "saved", "HEAD");
    const dhSaved = dh.rows();
    check("...and once a branch holds it the detached row is gone and the branch is what is reported; a detached HEAD at a commit the Hub lists is clean (R8-detached-clean)",
      !rowOf(dhSaved, "Detached HEAD work not on the Review Hub") && reported(dhSaved, "saved") && (() => { dh.f("checkout", "-q", "--detach", "origin/main"); return !rowOf(dh.rows(), "Detached HEAD work not on the Review Hub"); })());
    // (7) apply / read-tree / write-tree and refs/replace: a LEGIT hunks-only landing stays cleared with a replace ref on the squash parent's blob
    const ap = mkFx("r8ap");
    ap.c("a.txt", "one\ntwo\nthree\n"); ap.c("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n"); ap.f("push", "-q", "origin", "main");
    ap.f("checkout", "-q", "-b", "feat"); ap.put("a.txt", "one\nTWO\nthree\n"); ap.put("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n- r7 (feat)\n"); ap.f("add", "-A"); ap.f("commit", "-q", "-m", "feat");
    ap.f("checkout", "-q", "main"); ap.c("shared.md", "- r1\n- r2 (main moved)\n- r3\n- r4\n- r5\n- r6\n", "main moves shared"); const apP = ap.f("rev-parse", "HEAD");
    ap.f("merge", "-q", "--squash", "feat"); ap.f("commit", "-q", "-m", "squash feat"); ap.f("push", "-q", "origin", "main");
    const apBefore = landedByPatchId("feat", R6M, ap.w);
    ap.f("replace", ap.f("rev-parse", `${apP}:shared.md`), blobOf(ap, "garbage that no hunk applies to\n"));
    check("a legitimate hunks-only landing still clears with a refs/replace entry on the squash parent's blob: the apply, read-tree and write-tree spawns read the real objects too (R8-AP)",
      apBefore === true && ap.f("cat-file", "-p", `${apP}:shared.md`).startsWith("garbage") && landedByPatchId("feat", R6M, ap.w) === true);
    // (8) attributes: `-diff` / `binary` make git print "Binary files differ" for a TEXT file, and no two hunks could then be compared
    const at = mkFx("r8at"), atBody = "c1\nc2\nc3\nANCHOR\nc5\nc6\nc7\n";
    at.c("a.txt", "one\ntwo\nthree\n"); at.c("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n"); at.c("bin.dat", "AAAA\n"); const atB = at.f("rev-parse", "HEAD"); at.f("push", "-q", "origin", "main");
    at.f("checkout", "-q", "-b", "feat"); at.put("a.txt", "one\nTWO\nthree\n"); at.put("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n- r7 (feat)\n"); at.f("add", "-A"); at.f("commit", "-q", "-m", "feat");
    at.f("checkout", "-q", "-b", "real", "feat"); at.c("extra.txt", "REAL unpushed line\n", "real extra");
    at.f("checkout", "-q", "-b", "binb", atB); at.c("bin.dat", "BRANCH-ONLY bytes\n", "bin branch");
    at.f("checkout", "-q", "main"); at.c("shared.md", "- r1\n- r2 (main moved)\n- r3\n- r4\n- r5\n- r6\n", "main moves shared"); at.f("merge", "-q", "--squash", "feat"); at.f("commit", "-q", "-m", "squash feat");
    at.c("bin.dat", "MAINLINE bytes\n", "squash of a different bin change"); at.f("push", "-q", "origin", "main");
    const atPlain = landedByPatchId("feat", R6M, at.w);
    writeFileSync(join(at.w, ".git", "info", "attributes"), "* -diff\n");
    check("with `* -diff` in .git/info/attributes a legit hunks-only landing still clears, a branch with one extra real line and a different binary change to the same path stay reported (R8-attr)",
      atPlain === true && landedByPatchId("feat", R6M, at.w) === true && landedByPatchId("real", R6M, at.w) === false && landedByPatchId("binb", R6M, at.w) === false && hasLandedByContent("binb", R6M, at.w) === false);
    // (9) R7-spawns, quote-agnostic: the scanner is a function so the synthetic samples can test it
    check("the stray-git scanner is quote-agnostic: double, single and backtick quotes, execFile, spawn and exec forms are all found, the two allowed forms are not (R8-spawns-scan)",
      strayGit(`execFileSync('git', ['rev-parse'])`).length === 1 && strayGit("spawnSync(`git`, [`log`])").length === 1 && strayGit(`execFile("git", ["log"], cb)`).length === 1 &&
      strayGit(`spawn('git',['status'])`).length === 1 && strayGit(`execSync("git status")`).length === 1 && strayGit(`execFileSync('git', ['ls-remote', '--heads'])`).length === 1 &&
      strayGit(`spawnSync("git", ["-c", "core.commitGraph=false", "-C", dir, ...args])`).length === 0 && strayGit(`spawnSync("git", ["-c", "core.commitGraph=false", ...args])`).length === 1 && strayGit(prodText).length === 0);
    // ══ ROUND 9 ══ The round-8 refuter's fixtures (the proxy repository, dDetach, dShallowKL, dProbe P3, dEnv), rebuilt beside the rows they must change.
    // Each case builds the lie first (a precondition inside its own check) and then asks the guarded answer; each FAILS on the round-8 file.
    const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
    const cfgFile = (name, text) => { const p = join(root, name); writeFileSync(p, text); return p; };
    // hermetic: a developer's (or a CI runner's) own global or system sslVerify / proxy settings, or a GIT_SSL_NO_VERIFY, must not decide the cases below
    const hermetic = { GIT_CONFIG_GLOBAL: cfgFile("r9-empty-global.cfg", ""), GIT_CONFIG_NOSYSTEM: "1", GIT_SSL_NO_VERIFY: null };
    const inCleanEnv = (fn, vars = {}) => withEnvVars({ ...hermetic, ...vars }, fn);
    const ctOf = (fx, tree, msg, ...parents) => execFileSync("git", ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", msg], { cwd: fx.w, encoding: "utf8", env: FX_ENV }).trim();
    const dropLoose = (fx, sha) => { // true when the loose object was there and is gone; the unlink is the check
      try { unlinkSync(join(fx.w, ".git", "objects", sha.slice(0, 2), sha.slice(2))); return true; } catch (e) { if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return false; throw e; }
    };
    // (1) The Hub transport. A repository-scope http.proxy plus http.sslVerify=false served a listing through a TLS-terminating proxy with the URL untouched.
    const tx = mkFx("r9tx"); tx.f("config", "remote.origin.url", HUB);
    const txc = mkFx("r9txc"); txc.f("config", "remote.origin.url", HUB); // a clean repository: nothing of its own below the environment's boundary
    const txBase = inCleanEnv(() => hubTransport(tx.w));
    tx.f("config", "http.proxy", "http://127.0.0.1:39689");
    const txProxy = inCleanEnv(() => hubTransport(tx.w));
    tx.f("config", "http.sslVerify", "false");
    const txSsl = inCleanEnv(() => hubTransport(tx.w));
    check("a repository-scope http.proxy and http.sslVerify=false are gated findings naming the key, the value, the scope and the file, where the same repository without them has none (R9-tx-local)",
      txBase.problems.length === 0 && txProxy.problems.length === 1 && /^repository-scope http\.proxy=http:\/\/127\.0\.0\.1:39689 \(local \.git\/config\) can redirect or weaken the Hub transport$/.test(txProxy.problems[0]) &&
      txSsl.problems.length === 2 && txSsl.problems.some((p) => /^http\.sslverify=false \(local \.git\/config\) turns TLS verification off$/.test(p)) && /http\.proxy/.test(inCleanEnv(() => hubUrlProblem(tx.w))));
    const txw = mkFx("r9txw"); txw.f("config", "extensions.worktreeConfig", "true"); txw.f("config", "--worktree", "http.proxy", "http://127.0.0.1:1");
    const txi = mkFx("r9txi"), txInc = cfgFile("r9-include.cfg", "[http]\n\tproxy = http://127.0.0.1:2\n"); txi.f("config", "include.path", txInc);
    const txu = mkFx("r9txu"); txu.f("config", "url.git@github.com:.insteadOf", "https://github.com/"); // host-preserving, but a REPOSITORY chose it
    const txg = mkFx("r9txg"); txg.f("config", "core.gitProxy", "/tmp/x-proxy"); txg.f("config", "http.postBuffer", "524288000");
    check("scope decides, not the file name: a worktree-scope http.proxy, a proxy pulled in by a local include.path, a repository-scope url.*.insteadOf (even host-preserving) and core.gitProxy are gated, and a harmless tuning key (http.postBuffer) is not (R9-tx-scope)",
      inCleanEnv(() => hubTransport(txw.w)).problems.some((p) => /^repository-scope http\.proxy=http:\/\/127\.0\.0\.1:1 \(worktree /.test(p)) &&
      inCleanEnv(() => hubTransport(txi.w)).problems.some((p) => p.includes("repository-scope http.proxy=http://127.0.0.1:2") && p.includes(txInc)) &&
      inCleanEnv(() => hubTransport(txu.w)).problems.some((p) => /^repository-scope url\.git@github\.com:\.insteadof=https:\/\/github\.com\/ \(local /.test(p)) &&
      inCleanEnv(() => hubTransport(txg.w)).problems.length === 1 && /core\.gitproxy/.test(inCleanEnv(() => hubTransport(txg.w)).problems[0]));
    // the same keys below the environment's own boundary (the global file, the command line) are what the sandbox's proxy and CA ARE: reported, not gated
    const gProxy = cfgFile("r9-global-proxy.cfg", "[http]\n\tproxy = http://user:s3cret@proxy.invalid:3128\n\tsslVerify = true\n\tsslCAInfo = /etc/ssl/corp-ca.pem\n");
    const gTrusted = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: gProxy });
    check("the same proxy and CA keys in the user's GLOBAL configuration, with sslVerify true, are reported as trusted (userinfo removed) and are no finding (R9-tx-global-report)",
      gTrusted.problems.length === 0 && gTrusted.trusted.some((t) => t.includes("global") && t.includes("http.proxy=http://proxy.invalid:3128")) && gTrusted.trusted.some((t) => t.includes("http.sslcainfo=/etc/ssl/corp-ca.pem")) &&
      !JSON.stringify(gTrusted).includes("s3cret") && /^trusted, not verified: /.test(gTrusted.note));
    const gOff = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r9-global-ssl.cfg", "[http]\n\tsslVerify = false\n") });
    const gOffUrl = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r9-global-url.cfg", "[http \"https://github.com/\"]\n\tsslVerify = off\n") });
    const gOffProxy = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r9-global-proxyssl.cfg", "[http]\n\tproxySSLVerify = no\n") });
    check("http.sslVerify=false is gated at ANY scope, the per-URL form, the 'off' spelling and http.proxySSLVerify included (R9-tx-sslverify-any)",
      gOff.problems.some((p) => /^http\.sslverify=false \(global .*r9-global-ssl\.cfg\) turns TLS verification off$/.test(p)) && gOffUrl.problems.some((p) => /^http\.https:\/\/github\.com\/\.sslverify=off \(global /.test(p)) &&
      gOffProxy.problems.some((p) => /^http\.proxysslverify=no \(global .*\) turns TLS verification off$/.test(p)));
    check("an entry in a scope this git never prints is the repository's own and is gated, where the same key in the global or system scope is only reported, and a bare sslVerify key counts as true (R9-tx-scope-unknown)",
      /^repository-scope http\.proxy=http:\/\/h:1 \(submodule \.gitmodules\)/.test(transportKey("submodule", "file:.gitmodules", "http.proxy\nhttp://h:1").problem || "") &&
      transportKey("global", "file:/x", "http.proxy\nhttp://h:1").problem === undefined && transportKey("system", "file:/x", "http.proxy\nhttp://h:1").trusted === "system /x: http.proxy=http://h:1" &&
      transportKey("command", "command line:", "url.https://github.com/.insteadof\ngit@github.com:").trusted === "command line: url.https://github.com/.insteadof=git@github.com:" &&
      transportKey("global", "file:/x", "http.sslverify").problem === undefined && transportKey("local", "file:.git/config", "http.postbuffer\n1").problem === undefined);
    const noVerify = inCleanEnv(() => ({ t: hubTransport(txc.w), env: gitEnv({ KEEP: "x" }) }), { GIT_SSL_NO_VERIFY: "1" });
    check("GIT_SSL_NO_VERIFY in the environment is a gated finding, and no git this file starts inherits it (R9-tx-env-noverify)",
      noVerify.t.problems.length === 1 && /^GIT_SSL_NO_VERIFY is set in the environment/.test(noVerify.t.problems[0]) && !("GIT_SSL_NO_VERIFY" in noVerify.env) && noVerify.env.KEEP === "x");
    const rewriteWith = (vars) => inCleanEnv(() => hubTransport(txc.w), vars);
    const rwCmdEvil = rewriteWith({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.https://evil.example/.insteadOf", GIT_CONFIG_VALUE_0: "https://github.com/" });
    const rwCmdSame = rewriteWith({ GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "credential.interactive", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf", GIT_CONFIG_VALUE_1: "git@github.com:", GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf", GIT_CONFIG_VALUE_2: "ssh://git@github.com/" });
    const rwGlobEvil = rewriteWith({ GIT_CONFIG_GLOBAL: cfgFile("r9-global-evil.cfg", "[url \"https://mirror.example/\"]\n\tinsteadOf = https://github.com/\n") });
    const rwGlobSsh = rewriteWith({ GIT_CONFIG_GLOBAL: cfgFile("r9-global-ssh.cfg", "[url \"git@github.com:\"]\n\tinsteadOf = https://github.com/\n") });
    check("a rewrite of the Hub URL that changes its host is gated at the command line and in the global file; the sandbox's own host-preserving entries (GIT_CONFIG_*), and a global https-to-ssh rewrite of the same repository, are reported and not gated (R9-tx-rewrite)",
      rwCmdEvil.problems.length === 1 && /rewrites the Hub URL .* to https:\/\/evil\.example\/DanFashauer\/SignalGrid-Review-Hub\.git/.test(rwCmdEvil.problems[0]) &&
      rwGlobEvil.problems.length === 1 && /rewrites the Hub URL .* to https:\/\/mirror\.example\//.test(rwGlobEvil.problems[0]) &&
      rwCmdSame.problems.length === 0 && rwCmdSame.trusted.some((t) => t.startsWith("command line: url.https://github.com/.insteadof=git@github.com:")) &&
      rwGlobSsh.problems.length === 0 && rwGlobSsh.trusted.some((t) => t.includes("rewrites the Hub URL to git@github.com:DanFashauer/SignalGrid-Review-Hub.git")));
    const envNote = inCleanEnv(() => hubTransport(txc.w), { HTTPS_PROXY: "http://agent:pw123@127.0.0.1:9", https_proxy: "http://agent:pw123@127.0.0.1:9", ALL_PROXY: null, all_proxy: null, GIT_SSL_CAINFO: "/etc/agent/ca.pem" });
    check("the environment's proxy and CA are named as trusted-not-verified in the row text, once per distinct proxy, with the proxy's userinfo removed, and are no finding (R9-tx-env-trusted)",
      envNote.problems.length === 0 && envNote.note.includes("environment proxy HTTPS_PROXY/https_proxy=http://127.0.0.1:9") && envNote.note.split("environment proxy").length === 2 && envNote.note.includes("environment CA GIT_SSL_CAINFO=/etc/agent/ca.pem") && !envNote.note.includes("pw123"));
    const badCfg = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r9-global-bad.cfg", "[http\nproxy=\n") });
    check("a configuration git cannot read is a finding, never an empty clean scan (R9-tx-unreadable)",
      badCfg.problems.some((p) => /^git could not read its configuration/.test(p)));
    const txh = mkFx("r9txh"); txh.f("config", "remote.origin.url", HUB);
    txh.f("config", "http.https://github.com/.extraheader", "AUTHORIZATION: basic c2VjcmV0LXRva2Vu"); txh.f("config", "http.postBuffer", "524288000");
    const txhScan = inCleanEnv(() => hubTransport(txh.w));
    check("the credential actions/checkout writes as a repository-scope http.<url>.extraheader, and a tuning key, are no finding and are never printed (R9-tx-harmless)",
      txhScan.problems.length === 0 && !JSON.stringify(txhScan).includes("c2VjcmV0LXRva2Vu") && !/extraheader|postbuffer/i.test(txhScan.note));
    // the whole script. Stand-in for the refuter's TLS-terminating proxy: a `git` first on PATH that answers `ls-remote --heads` with a listing of its own
    // (everything else is the real git), so the lie is on offer exactly where the proxy offered it.
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), fakeBin = join(root, "r9bin");
    mkdirSync(fakeBin); writeFileSync(join(fakeBin, "git"), "#!/bin/sh\nfor a in \"$@\"; do\n  if [ \"$a\" = \"--heads\" ]; then [ -n \"$R16_LISTED\" ] && : > \"$R16_LISTED\"; cat \"$R9_FAKE_LISTING\"; exit 0; fi\ndone\nexec \"$R9_REAL_GIT\" \"$@\"\n", { mode: 0o755 });
    const wholeScript = (fx, name, vars = {}, opts = {}) => {
      // opts.hub: run a copy of the script whose Hub constant is another URL (a reserved host, so no fixture carries a credential for a real one)
      const hubLine = `const HUB = "${HUB}";`, copy = opts.hub ? prodSrc.replace(hubLine, `const HUB = "${opts.hub}";`) : prodSrc;
      if (opts.hub && (!prodSrc.includes(hubLine) || copy === prodSrc)) throw new Error("the Hub constant is not where the self-test expects it");
      mkdirSync(join(fx.w, "scripts"), { recursive: true }); writeFileSync(join(fx.w, "scripts", "loop-state.mjs"), copy);
      const listing = cfgFile(`${name}-listing`, `${hubMapOf(fx.h).get("main")}\trefs/heads/main\n`);
      const childEnv = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, R9_REAL_GIT: realGit, R9_FAKE_LISTING: listing, R16_LISTED: join(root, `${name}-listed`), GIT_CONFIG_GLOBAL: hermetic.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: "1", ...vars };
      delete childEnv.GIT_SSL_NO_VERIFY;
      for (const [k, v] of Object.entries(vars)) if (v === null) delete childEnv[k]; // (null: unset)
      const r = spawnSync(process.execPath, [join(fx.w, "scripts", "loop-state.mjs")], { cwd: fx.w, encoding: "utf8", timeout: 120000, env: childEnv });
      return { status: r.status, out: stripAnsi(r.stdout), err: String(r.stderr || ""), listed: readIfPresent(join(root, `${name}-listed`)) !== null }; // listed: the Hub listing was ASKED FOR
    };
    const txe = mkFx("r9txe"); txe.f("config", "remote.origin.url", HUB);
    const txeClean = wholeScript(txe, "r9txe-a", { HTTPS_PROXY: "http://agent:pw123@127.0.0.1:9", https_proxy: "http://agent:pw123@127.0.0.1:9", ALL_PROXY: "", all_proxy: "", GIT_SSL_CAINFO: "/etc/agent/ca.pem" });
    txe.f("config", "http.proxy", "http://127.0.0.1:39689"); txe.f("config", "http.sslVerify", "false");
    const txeLie = wholeScript(txe, "r9txe-b");
    check("the whole check, with a repository-scope http.proxy and http.sslVerify=false and a listing served by whatever sits behind them, exits 1 with a failing Hub-URL row and never reads the listing; the same repository without them reads it and names what it trusted, as a warning (R9-tx-e2e)",
      txeLie.status === 1 && /✗ Review Hub URL\s+repository-scope http\.proxy=http:\/\/127\.0\.0\.1:39689/.test(txeLie.out) && !/all present on the Review Hub/.test(txeLie.out) && !/Review Hub transport/.test(txeLie.out) &&
      /! Review Hub transport\s+listing read from /.test(txeClean.out) && txeClean.out.includes("trusted, not verified: ") && /environment proxy HTTPS_PROXY(\/https_proxy)?=http:\/\/127\.0\.0\.1:9\b/.test(txeClean.out) &&
      txeClean.out.includes("environment CA GIT_SSL_CAINFO=/etc/agent/ca.pem") && !txeClean.out.includes("pw123") && /all present on the Review Hub/.test(txeClean.out));

    // (2) detached HEAD. Evidence is a local branch or a commit the Hub lists, never a remote-tracking ref (anyone can write one) and never a tag.
    const dhe = mkFx("r9dh1");
    dhe.f("checkout", "-q", "--detach"); const dheT = dhe.c("d.txt", "REAL detached work the Hub never saw\n", "detached work");
    const dheRowOf = () => rowOf(dhe.rows(), "Detached HEAD work not on the Review Hub");
    const dheKept = [];
    for (const [label, plant, unplant] of [["refs/remotes/evil/x", () => dhe.f("update-ref", "refs/remotes/evil/x", dheT), () => dhe.f("update-ref", "-d", "refs/remotes/evil/x")],
      ["refs/remotes/origin/pr/999", () => dhe.f("update-ref", "refs/remotes/origin/pr/999", dheT), () => dhe.f("update-ref", "-d", "refs/remotes/origin/pr/999")],
      ["a tag", () => dhe.f("tag", "keep", dheT), () => dhe.f("tag", "-d", "keep")]]) {
      plant(); const row = dheRowOf(); unplant();
      dheKept.push(label, !!row && row.state === "fail" && row.gated === true && row.detail.startsWith(`HEAD (detached at ${dheT.slice(0, 12)}) carries 1 commit(s) no local branch or Hub-listed commit holds`));
    }
    check("a hand-made refs/remotes/evil/x, a hand-made refs/remotes/origin/pr/999 and a tag at the detached tip each leave the detached-HEAD row gated; only a local branch or a Hub-listed commit clears it (R9-detach)",
      dhe.f("rev-parse", "HEAD") === dheT && dheKept.length === 6 && dheKept.filter((x) => typeof x === "boolean").every(Boolean) && (dhe.f("branch", "saved", "HEAD"), !dheRowOf()));
    const dhl = mkFx("r9dh2");
    dhl.f("checkout", "-q", "--detach"); dhl.f("branch", "-D", "main"); const dhlOld = dhl.f("rev-parse", "HEAD");
    const dhlStale = (() => { hubAdvance(dhl, "main"); return dhl.rows(); })(); // the Hub moved main; this checkout has not fetched; HEAD is origin/main's old commit, held by no branch
    const dhlRow = rowOf(dhlStale, "Detached HEAD work not on the Review Hub");
    dhl.f("fetch", "-q", "origin");
    check("a detached HEAD at origin/main's OLD commit, held by no branch while the Hub's main is not fetched, is still gated but says run a fetch; once fetched, the Hub's listed main holds it and the row is gone (R9-detach-fetch)",
      dhl.f("rev-parse", "HEAD") === dhlOld && !!dhlRow && dhlRow.gated === true && dhlRow.detail.includes("origin/main is behind the Hub: run git fetch origin, then re-run") && !rowOf(dhl.rows(), "Detached HEAD work not on the Review Hub"));
    // a forged-name parent under a real Hub commit (the R8-chain construction): the Hub lists H2 over P2, the local P2 is a forgery whose content names the tip
    const mkForged = (name) => {
      const f = mkFx(name);
      f.f("checkout", "-q", "-b", "oth"); f.c("o.txt", "o\n"); f.f("push", "-q", "origin", "oth:refs/heads/other");
      f.f("checkout", "-q", "-b", "mine", "main"); const T = f.c("w.txt", "REAL unpushed\n"); f.f("branch", "-D", "oth");
      const hg = (...a) => execFileSync("git", ["-C", f.h, ...a], { encoding: "utf8", env: FX_ENV }).trim(), O = hg("rev-parse", "refs/heads/other");
      const P2 = hg("commit-tree", `${O}^{tree}`, "-p", O, "-m", "hub P2"), H2 = hg("commit-tree", `${O}^{tree}`, "-p", P2, "-m", "hub H2"); hg("update-ref", "refs/heads/other", H2);
      execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: f.w, input: execFileSync("git", ["-C", f.h, "cat-file", "commit", H2]), encoding: "utf8", env: FX_ENV });
      plantLoose(f, P2, Buffer.from(`tree ${f.f("rev-parse", `${T}^{tree}`)}\nparent ${T}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nforged P2\n`));
      return { f, T, H2, P2, map: hubMapOf(f.h) };
    };
    const dff = mkForged("r9dh3");
    dff.f.f("checkout", "-q", "--detach", dff.T); dff.f.f("branch", "-D", "mine");
    const dffRow = rowOf(dff.f.rows(), "Detached HEAD work not on the Review Hub");
    check("a detached HEAD whose only cover is a real Hub commit over a forged-name parent is not covered: the chain is re-hashed and the row says why (R9-detach-chain)",
      localCommits(dff.f.w, [dff.H2]).has(dff.H2) && !localCommits(dff.f.w, [dff.P2]).has(dff.P2) && dff.f.f("rev-list", "--count", "HEAD", `^${dff.H2}`) === "0" && !!dffRow && dffRow.gated === true && /hand-made object in the ancestry/.test(dffRow.detail));

    // (3) shallow boundaries. dShallowKL: mainline reaches the boundary B by a SIDE parent C (a commit the branch really has below the cut), so C appeared as a landing after the fork.
    const skl = mkFx("r9skl");
    const sklV1 = blobOf(skl, "f=v1\n"), sklV2 = blobOf(skl, "f=v2 FEATURE\n"), sklBase = blobOf(skl, "base\n");
    const sklT1 = treeOf(skl, [["base.txt", sklBase], ["f.txt", sklV1]]), sklT2 = treeOf(skl, [["base.txt", sklBase], ["f.txt", sklV2]]);
    const sklR = ctOf(skl, sklT1, "R"), sklC = ctOf(skl, sklT2, "C: the feature, on the Hub, reverted later", sklR), sklP = ctOf(skl, sklT1, "P: revert", sklC);
    const sklB = ctOf(skl, sklT1, "B: boundary", sklP), sklT = ctOf(skl, sklT2, "T: LOCAL re-apply of the reverted feature", sklB), sklM = ctOf(skl, sklT1, "M: mainline merge reaching C by a side parent, and B", sklB, sklC);
    skl.f("push", "-q", "-f", "origin", `${sklM}:refs/heads/main`); skl.f("update-ref", "refs/heads/main", sklM); // the Hub's main IS sklM, so mainline is anchored (R12) and the shallow rule is what is under test
    skl.f("update-ref", "refs/heads/work", sklT);
    writeFileSync(join(skl.w, ".git", "shallow"), `${sklB}\n`);
    const sklCut = dropLoose(skl, sklP);
    const sklTrace = { blocked: "" }, sklSb = shallowBounds(skl.w, "refs/heads/work", R6M);
    const sklBytes = hasLandedByContent("work", R6M, skl.w, sklTrace), sklHunks = landedByPatchId("work", R6M, skl.w), sklRows = skl.rows(), sklRow = rowOf(sklRows, T_UNPUSHED);
    check("a local re-apply of a feature mainline made and reverted below a shared opaque shallow boundary is NOT squash-landed: the mainline commit carrying it does not descend from the boundary, so neither the byte check nor the hunk check clears it, and the row names the cut and the remedy (R9-skl)",
      sklCut && skl.f("rev-parse", "--is-shallow-repository") === "true" && sklSb.off === "" && (sklSb.opaque || []).join() === sklB && sklBytes === false && sklTrace.blocked === sklB && sklHunks === false &&
      !!sklRow && sklRow.gated === true && sklRow.detail.startsWith("work — push, or confirm the remote") && sklRow.detail.includes(`does not descend from the shallow boundary ${sklB.slice(0, 12)}`) && sklRow.detail.includes("--deepen=N"));
    // ...and the ordinary shallow lane, cut ON mainline: the squash that landed the work is newer than the boundary, so both exemptions still clear
    const shl = mkFx("r9shl");
    shl.c("f.txt", "v1\n", "B"); shl.put("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n"); shl.f("add", "-A"); shl.f("commit", "-q", "-m", "B: shared file"); const shlB = shl.f("rev-parse", "HEAD"); shl.f("push", "-q", "origin", "main");
    shl.f("checkout", "-q", "-b", "work"); shl.put("f.txt", "v2\n"); shl.put("shared.md", "- r1\n- r2\n- r3\n- r4\n- r5\n- r6\n- r7 (feat)\n"); shl.f("add", "-A"); shl.f("commit", "-q", "-m", "feat");
    shl.f("checkout", "-q", "-b", "workb", shlB); shl.c("f.txt", "v2\n", "feat b");
    shl.f("checkout", "-q", "main"); const shlU = shl.c("shared.md", "- r1\n- r2 (main moved)\n- r3\n- r4\n- r5\n- r6\n", "U: main moves shared"); shl.f("merge", "-q", "--squash", "work"); shl.f("commit", "-q", "-m", "S: squash feat");
    shl.c("f.txt", "v3\n", "S2: f.txt moves on"); shl.f("push", "-q", "origin", "main");
    const shlA0 = shl.f("rev-parse", `${shlB}^`);
    writeFileSync(join(shl.w, ".git", "shallow"), `${shlB}\n`);
    const shlCut = dropLoose(shl, shlA0);
    const shlRows = shl.rows(), shlTrace = { blocked: "" };
    check("the ordinary shallow lane still clears: with the boundary ON mainline and the squash newer than it, a hunks-only landing and a bytes-landing (the file moved on afterwards) both stay cleared (R9-skl-legit)",
      shlCut && shl.f("rev-parse", "--is-shallow-repository") === "true" && (shallowBounds(shl.w, "refs/heads/work", R6M).opaque || []).join() === shlB && hasLandedByContent("work", R6M, shl.w, shlTrace) === false &&
      landedByPatchId("work", R6M, shl.w, shlTrace) === true && shlTrace.blocked === "" && hasLandedByContent("workb", R6M, shl.w) === true && !rowOf(shlRows, T_UNPUSHED) && rowOf(shlRows, T_CLEAN).detail.includes("squash-landed"));
    // a cut INSIDE the branch's own commits (mainline never reaches the boundary): the exemptions are off and the row says to deepen the checkout
    const cut = mkFx("r9cut");
    cut.f("checkout", "-q", "-b", "cutown"); const cutP1 = cut.c("p1.txt", "1\n", "P1"), cutB = cut.c("p2.txt", "2\n", "B"); cut.c("t.txt", "3\n", "T");
    writeFileSync(join(cut.w, ".git", "shallow"), `${cutB}\n`); const cutDropped = dropLoose(cut, cutP1);
    const cutRow = rowOf(cut.rows(), T_UNPUSHED), cutSb = shallowBounds(cut.w, "refs/heads/cutown", R6M);
    check("a shallow cut inside the branch's own commits that mainline does not reach turns the exemptions off and the row says: git fetch --deepen=N origin (R9-skl-deepen)",
      cutDropped && cutSb.off.includes("--deepen=N") && !!cutRow && cutRow.detail.includes("cutown: the history below the shallow boundary") && cutRow.detail.includes("--deepen=N"));

    // (4) the same-name zero is earned. A real Hub commit over a forged-name parent hid the branch tip behind it: aheadOfHub read same, commitsBeyondHub read 0.
    const fg = mkForged("r9fg");
    fg.f.f("branch", "other", fg.T);
    const fgAhead = aheadOfHub("other", fg.H2, fg.f.w), fgBeyond = commitsBeyondHub(fg.f.w, "other", fg.map, "");
    const fgRows = fg.f.rows(), fgSame = rowOf(fgRows, "Local tip ahead of its same-named Hub branch");
    const fgVerdict = sameNameVerdict("other", fg.H2, fg.map, fg.f.w);
    check("a tip hidden behind a real Hub commit by a forged-name parent is no longer 'at or behind the Hub': aheadOfHub gives an unproven zero, commitsBeyondHub cannot count, and the same-name row is a gated failure with the count unreadable (R9-ahead-forged)",
      fg.f.f("rev-list", "--count", `${fg.H2}..refs/heads/other`) === "0" && !localCommits(fg.f.w, [fg.P2]).has(fg.P2) && fgAhead.state === "unknown" && /hand-made object in the ancestry/.test(fgAhead.reason) && fgBeyond === "" &&
      fgVerdict.state === "ahead" && fgVerdict.ahead === null && !!fgSame && fgSame.state === "fail" && fgSame.gated === true && /other \(count unreadable\)/.test(fgSame.detail));
    const lg = mkFx("r9lg");
    lg.f("checkout", "-q", "-b", "feat"); const lgOld = lg.c("a.txt", "1\n", "A"); lg.f("push", "-q", "origin", "feat"); hubAdvance(lg, "feat"); lg.f("fetch", "-q", "origin");
    const lgMap = hubMapOf(lg.h), lgAhead = aheadOfHub("feat", lgMap.get("feat"), lg.w), lgAt = aheadOfHub("feat", lgOld, lg.w);
    check("a branch genuinely behind its Hub tip (a real chain, every commit hashing to its name) still reads same, with a zero count; a branch at its Hub tip too (R9-ahead-legit)",
      lg.f("rev-parse", "refs/heads/feat") === lgOld && lgAhead.state === "same" && lgAhead.ahead === 0 && lgAt.state === "same" && commitsBeyondHub(lg.w, "feat", lgMap, "") === "0");

    // the descent from the boundary is proved with every commit on the way re-hashed: a forged-name commit between the boundary and the landing commit claims the descent and is not believed
    const shlUBody = Buffer.from(`tree ${shl.f("rev-parse", `${shlU}^{tree}`)}\nparent ${shlB}\nauthor t <t@t> 1 +0000\ncommitter t <t@t> 1 +0000\n\nforged U\n`);
    const shlForgedDropped = dropLoose(shl, shlU); plantLoose(shl, shlU, shlUBody);
    const shlForgedTrace = { blocked: "" };
    check("a forged-name commit between the shallow boundary and the squash that landed the work does not prove the squash newer than the boundary: the bytes-landing is reported again and the trace names the boundary (and the hunks-only landing, whose apply git refuses on the forged commit, is reported too) (R9-skl-forged-chain)",
      shlForgedDropped && !localCommits(shl.w, [shlU]).has(shlU) && hasLandedByContent("workb", R6M, shl.w, shlForgedTrace) === false && shlForgedTrace.blocked === shlB && landedByPatchId("work", R6M, shl.w) === false && !!rowOf(shl.rows(), T_UNPUSHED));
    // an unfetched same-name tip counted against the tracking ref: the zero is earned here too
    const bt = mkForged("r9bt");
    bt.f.f("branch", "other", bt.T); bt.f.f("update-ref", "refs/remotes/origin/other", bt.H2); hubAdvance(bt.f, "other");
    const btMap = hubMapOf(bt.f.h), btV = sameNameVerdict("other", btMap.get("other"), btMap, bt.f.w), btRow = rowOf(bt.f.rows(), "Local tip ahead of its same-named Hub branch");
    check("an unfetched same-name tip that its own tracking ref hides behind a forged-name parent is a gated ahead counted against the Hub's listed commits, not the quiet 'not fetched' warning: the tracking ref is no evidence at all (R9-beyond-tracking)",
      !hasObject(bt.f, btMap.get("other")) && bt.f.f("rev-list", "--count", "refs/heads/other", "^refs/remotes/origin/other") === "0" && btV.state === "ahead" && Number.isInteger(btV.ahead) && btV.ahead >= 1 && btV.beyond === "the Hub's listed commits" &&
      !!btRow && btRow.gated === true && /^other \(\+\d+ beyond the Hub's listed commits\)/.test(btRow.detail) && btRow.detail.includes("origin/other is behind the Hub: run git fetch origin"));

    // (5) the environment. A GIT_DIR at a decoy hid every real branch; the other variables point reads at a repository, worktree, namespace or transport this check did not choose.
    const en = mkFx("r9en");
    en.f("checkout", "-q", "-b", "realwork"); en.c("w.txt", "REAL unpushed\n");
    const decoy = join(root, "r9en-decoy"); execFileSync("git", ["init", "-q", "-b", "main", decoy], { env: FX_ENV });
    execFileSync("git", ["-C", decoy, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "clean"], { env: FX_ENV });
    const enMap = hubMapOf(en.h);
    const enUnder = withEnvVars({ GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_COMMON_DIR: join(decoy, ".git"), GIT_NAMESPACE: "evil" }, () => ({
      names: listLocalBranches(en.w).names, rows: branchSeamRows({ listing: listLocalBranches(en.w), hubBranches: [...enMap.keys()], hubShaMap: enMap, ephemeral: [], scratchExcluded: [], mainline: R6M, cwd: en.w }) }));
    const enUnpushed = rowOf(enUnder.rows, T_UNPUSHED);
    check("with GIT_DIR (and GIT_WORK_TREE, GIT_COMMON_DIR, GIT_NAMESPACE) pointing at a decoy repository the branches are still read from the repository asked about, and the unpushed branch is still reported (R9-env-gitdir)",
      enUnder.names.includes("realwork") && !!enUnpushed && enUnpushed.gated === true && enUnpushed.detail.startsWith("realwork") && execFileSync("git", ["-C", decoy, "for-each-ref", "--format=%(refname)", "refs/heads"], { encoding: "utf8", env: FX_ENV }).trim() === "refs/heads/main");
    const enGit = withEnvVars({ GIT_DIR: "/x/d", GIT_COMMON_DIR: "/x/c", GIT_WORK_TREE: "/x/w", GIT_NAMESPACE: "ns", GIT_PROXY_COMMAND: "/x/p", GIT_SSL_NO_VERIFY: "1", GIT_SSL_CAINFO: "/x/ca.pem",
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "c", GIT_TEST_COMMIT_GRAPH: "1", GIT_OBJECT_DIRECTORY: "/x/o" }, () => gitEnv({ GIT_INDEX_FILE: "/x/i" }));
    check("gitEnv drops GIT_DIR, GIT_COMMON_DIR, GIT_WORK_TREE, GIT_NAMESPACE, GIT_PROXY_COMMAND and GIT_SSL_NO_VERIFY, and KEEPS GIT_SSL_CAINFO, GIT_CONFIG_* and what its caller passes (R9-env-unit)",
      ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_NAMESPACE", "GIT_PROXY_COMMAND", "GIT_SSL_NO_VERIFY", "GIT_TEST_COMMIT_GRAPH", "GIT_OBJECT_DIRECTORY"].every((k) => !(k in enGit)) &&
      enGit.GIT_SSL_CAINFO === "/x/ca.pem" && enGit.GIT_CONFIG_COUNT === "1" && enGit.GIT_CONFIG_KEY_0 === "a.b" && enGit.GIT_CONFIG_VALUE_0 === "c" && enGit.GIT_INDEX_FILE === "/x/i");
    const relCwd = relative(process.cwd(), en.w);
    check("every git is pinned to the repository asked about, and a relative path to it is resolved once, never compounded by -C beside the spawn's cwd (R9-env-pin)",
      !isAbsolute(relCwd) && gitRun(relCwd, ["rev-parse", "--show-toplevel"]).stdout.trim() === realpathSync(en.w) && gitRun(join(root, "no-repo-here"), ["rev-parse", "--git-dir"]).ok === false &&
      /spawnSync\("git", \["-c", "core\.commitGraph=false", "-C", dir, \.\.\.args\]/.test(prodText)); // (the -C itself cannot change an answer beside the spawn's cwd, so the source is what is pinned)
    // ══ ROUND 10 ══ The round-9 refuter's two ranked items: the trusted-not-verified row must not look like a clean pass, and a key whose ORIGIN file lies inside the
    // repository is the repository's own whatever scope git names. Each case FAILS on a1b43b42.
    const cleanOfTrust = { GIT_CONFIG_COUNT: null, GIT_SSL_CAINFO: null, GIT_SSL_CAPATH: null, SSL_CERT_FILE: null, SSL_CERT_DIR: null, CURL_CA_BUNDLE: null, HTTPS_PROXY: null, https_proxy: null, ALL_PROXY: null, all_proxy: null };
    const cloudShape = { HTTPS_PROXY: "http://127.0.0.1:40381", https_proxy: "http://127.0.0.1:40381", GIT_SSL_CAINFO: "/root/.ccr/ca-bundle.crt" }; // what the cloud sandbox always sets
    const cloudScan = inCleanEnv(() => hubTransport(txc.w), { ...cloudShape, GIT_CONFIG_GLOBAL: gProxy });
    const cloudRow = transportRow(cloudScan);
    const cleanScan = inCleanEnv(() => hubTransport(txc.w), cleanOfTrust), cleanRow = transportRow(cleanScan);
    // trust that is NOT in the environment still makes the row a warning: a global proxy alone, a command-line rewrite alone
    const globalOnly = transportRow(inCleanEnv(() => hubTransport(txc.w), { ...cleanOfTrust, GIT_CONFIG_GLOBAL: gProxy }));
    const rewriteOnly = transportRow(inCleanEnv(() => hubTransport(txc.w), { ...cleanOfTrust, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf", GIT_CONFIG_VALUE_0: "git@github.com:" }));
    const txw2 = mkFx("r10warn"); txw2.f("config", "remote.origin.url", HUB);
    mkdirSync(join(txw2.w, "docs")); writeFileSync(join(txw2.w, "docs", "PURPOSE.md"), "fixture\n"); // so that no OTHER seam gates the exit code below
    const warnRun = wholeScript(txw2, "r10warn-a", cloudShape);
    check("a listing read through the environment's proxy and CA, or a global proxy, renders a WARNING row (!), never gating, whose text still lists what was trusted; the same shape through the whole script exits 0 with the ! row (R10-tx-warn)",
      cloudScan.problems.length === 0 && cloudScan.trusted.length >= 2 && cloudRow.state === "warn" && cloudRow.gated === false && cloudRow.what === "Review Hub transport" && cloudRow.detail.includes("trusted, not verified: ") &&
      cloudRow.detail.includes("through a transport this check cannot verify") && globalOnly.state === "warn" && globalOnly.detail.includes("http.proxy=http://proxy.invalid:3128") && rewriteOnly.state === "warn" && warnRun.status === 0 && /! Review Hub transport\s+listing read from .*trusted, not verified: environment proxy HTTPS_PROXY\/https_proxy=http:\/\/127\.0\.0\.1:40381; environment CA GIT_SSL_CAINFO=\/root\/\.ccr\/ca-bundle\.crt/.test(warnRun.out) &&
      !/✓ Review Hub transport/.test(warnRun.out) && /all present on the Review Hub/.test(warnRun.out));
    const cleanRun = wholeScript(txw2, "r10warn-b", cleanOfTrust);
    check("a listing read with no proxy, no CA override and no rewrite at any scope renders the green row, whose text says nothing was configured (R10-tx-clean)",
      cleanScan.problems.length === 0 && cleanScan.trusted.length === 0 && cleanRow.state === "ok" && cleanRow.gated === false && cleanRow.detail === `listing read from ${HUB}; no proxy, CA or URL rewrite configured; direct` &&
      cleanRun.status === 0 && /✓ Review Hub transport\s+listing read from .*no proxy, CA or URL rewrite configured; direct/.test(cleanRun.out) && !/! Review Hub transport/.test(cleanRun.out));
    // (2) a repository-owned file pulled in by a GLOBAL include.path
    const inc = mkFx("r10inc"); inc.f("config", "remote.origin.url", HUB);
    const incEvil = join(inc.w, "repoevil.cfg"); writeFileSync(incEvil, "[http]\n\tproxy = http://127.0.0.1:1\n");
    const incGitDir = join(inc.w, ".git", "gitdir-evil.cfg"); writeFileSync(incGitDir, "[url \"https://mirror.example/\"]\n\tinsteadOf = https://example.org/\n");
    const incGlobal = cfgFile("r10-global-include.cfg", `[include]\n\tpath = ${incEvil}\n[include]\n\tpath = ${incGitDir}\n`);
    const incScan = inCleanEnv(() => hubTransport(inc.w), { GIT_CONFIG_GLOBAL: incGlobal });
    const incLink = join(root, "r10-link.cfg"); symlinkSync(incEvil, incLink);
    const incViaLink = inCleanEnv(() => hubTransport(inc.w), { GIT_CONFIG_GLOBAL: cfgFile("r10-global-link.cfg", `[include]\n\tpath = ${incLink}\n`) });
    const incWt = join(root, "r10inc-wt"); inc.f("worktree", "add", "-q", incWt, "-b", "r10wt");
    const incFromWt = inCleanEnv(() => hubTransport(incWt), { GIT_CONFIG_GLOBAL: cfgFile("r10-global-gitdir.cfg", `[include]\n\tpath = ${incGitDir}\n`) });
    check("a key from a file INSIDE the repository (worktree, git dir, common git dir seen from a linked worktree, or a symlink to one) is gated whatever scope git reports, and the finding names the scope, the origin path and the include.path that pulled it in (R10-tx-include)",
      incScan.problems.length === 2 && /^repository-owned http\.proxy=http:\/\/127\.0\.0\.1:1 \(global scope, but read from .*\/r10inc\/work\/repoevil\.cfg, a file inside the repository, pulled in by include\.path in global .*r10-global-include\.cfg\) can redirect or weaken the Hub transport$/.test(incScan.problems[0]) &&
      /^repository-owned url\.https:\/\/mirror\.example\/\.insteadof=https:\/\/example\.org\/ \(global scope, but read from .*gitdir-evil\.cfg, a file inside the repository/.test(incScan.problems[1]) &&
      incViaLink.problems.length === 1 && incViaLink.problems[0].includes(`read from ${realpathSync(incEvil)}`) && incFromWt.problems.length === 1 && incFromWt.problems[0].includes("gitdir-evil.cfg") && /repository-owned/.test(inCleanEnv(() => hubUrlProblem(inc.w), { GIT_CONFIG_GLOBAL: incGlobal })));
    const incOutside = cfgFile("r10-outside.cfg", "[http]\n\tproxy = http://127.0.0.1:2\n"), incSibling = join(dirname(inc.w), "work2.cfg");
    writeFileSync(incSibling, "[http]\n\tproxy = http://127.0.0.1:3\n");
    const incOk = inCleanEnv(() => hubTransport(inc.w), { GIT_CONFIG_GLOBAL: cfgFile("r10-global-outside.cfg", `[include]\n\tpath = ${incOutside}\n[include]\n\tpath = ${incSibling}\n`) });
    check("the environment's own shape stays a warning: a global file, and files it includes, that lie OUTSIDE the repository (even a sibling whose path begins with the repository's) are reported as trusted and are no finding (R10-tx-include-outside)",
      incOk.problems.length === 0 && incOk.trusted.some((t) => t.includes("http.proxy=http://127.0.0.1:2")) && incOk.trusted.some((t) => t.includes("http.proxy=http://127.0.0.1:3")) && transportRow(incOk).state === "warn");
    // ══ ROUND 11 ══ CodeQL js/file-system-race: a file checked (existsSync / statSync) and then read or written. Absence is now the read's own answer (readIfPresent):
    // ENOENT and ENOTDIR are "absent", anything else is a failure and never a silent absent.
    const rpDir = join(root, "r11-rp"); mkdirSync(rpDir);
    const rpFile = join(rpDir, "f.txt"); writeFileSync(rpFile, "present\n");
    const rpCode = (fn) => { try { fn(); return "no error"; } catch (e) { return e && e.code; } };
    check("readIfPresent reads a present file, answers null for a missing one (ENOENT) and for a path under a file (ENOTDIR), and THROWS for everything else: a directory is EISDIR, never an absent file (R11-rip)",
      readIfPresent(rpFile) === "present\n" && readIfPresent(join(rpDir, "missing.txt")) === null && readIfPresent(join(rpFile, "child.txt")) === null &&
      rpCode(() => readIfPresent(rpDir)) === "EISDIR" && rpCode(() => readIfPresent(join(rpDir, "missing.txt"))) === "no error" &&
      dropLoose(skl, sklP) === false /* already dropped above: the unlink's ENOENT is "was not there", not a throw */ && rpCode(() => dropLoose({ w: rpFile }, "ab" + "c".repeat(38))) === "no error");
    // the whole script: LOOP.md or README.md that exists but cannot be read is a crash that names the error, where a missing one is a quiet "no date" warning
    const rpx = mkFx("r11rp"); rpx.f("config", "remote.origin.url", HUB);
    mkdirSync(join(rpx.w, "docs", "agent"), { recursive: true }); writeFileSync(join(rpx.w, "docs", "PURPOSE.md"), "fixture\n");
    const rpMissing = wholeScript(rpx, "r11rp-a", cleanOfTrust);
    mkdirSync(join(rpx.w, "docs", "agent", "LOOP.md")); // present, and a directory
    const rpDirRun = wholeScript(rpx, "r11rp-b", cleanOfTrust);
    check("the whole script treats a missing LOOP.md as the 'no LAST TOUCHED date' warning and a LOOP.md it cannot read (a directory) as a failure naming EISDIR, not as a missing one (R11-rip-e2e)",
      /! LOOP STATE date\s+no "LAST TOUCHED/.test(rpMissing.out) && !/EISDIR/.test(rpMissing.err) && rpDirRun.status !== 0 && /EISDIR/.test(rpDirRun.err) && !/LOOP STATE date/.test(rpDirRun.out));
    // a planted loose object REPLACES a git-written (read-only) one rather than being written over it: the inode changes, read through descriptors (no path is checked first)
    const lq = mkFx("r11lo"), loSha = lq.c("x.txt", "x\n", "X"), loFile = join(lq.w, ".git", "objects", loSha.slice(0, 2), loSha.slice(2));
    const inoOf = (file) => { const fd = openSync(file, "r"); try { return fstatSync(fd).ino; } finally { closeSync(fd); } };
    const loOld = openSync(loFile, "r"); // held open while the object is replaced, so its inode number cannot be handed straight back to the new file
    let loIno, loIno2; try { loIno = fstatSync(loOld).ino; writeLooseObject(lq.w, loSha, Buffer.from("commit 0\0")); loIno2 = inoOf(loFile); } finally { closeSync(loOld); }
    check("planting a loose object over one git already wrote (read-only) replaces it by unlink-then-write, so it works for a user who may not write the old file: new inode, and the content no longer hashes to its name (R11-loose-replace)",
      loIno !== loIno2 && !localCommits(lq.w, [loSha]).has(loSha));
    const rpProd = prodText.slice(prodText.indexOf("function readIfPresent"), prodText.indexOf("function readIfPresent") + 700);
    check("no existsSync / statSync check is followed by a read, write or unlink of the same path in this file: the README, the discovery log and LOOP.md are read through readIfPresent, the throwaway index is opened, the self-test drops a loose object by unlinking it (R11-no-check-then-use)",
      !/existsSync\(resolve\(repo, "README\.md"\)\)/.test(prodText) && !/existsSync\(logPath\)/.test(prodText) && !/existsSync\(loopPath\)/.test(prodText) && !/existsSync\(idx\)/.test(prodText) &&
      !/exist[s]Sync\(graftsFile\)/.test(prodSrc) && !/const was = exist[s]Sync/.test(prodSrc) && /function readIfPresent/.test(rpProd) && /e\.code === "ENOENT" \|\| e\.code === "ENOTDIR"/.test(rpProd));
    // ══ ROUND 12 ══ The independent review wave on ca9fdfa9 (wave77): a remote helper from repository configuration alone, a hand-made refs/remotes/origin/<mainline>, a hand-made
    // origin/<other> in the same-name gate, a credential in a config KEY, core.sshCommand, and a self-test that was not hermetic. Each case builds the lie first (a precondition inside its own check).
    const unreachable = { HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", ALL_PROXY: null, all_proxy: null }; // so nothing here can reach a real network
    // (1) a remote helper: remote.<Hub URL>.url=<Hub URL>, remote.<Hub URL>.vcs=rvfake, and an inline alias.remote-rvfake that answers `list` with a Hub of its own
    const rh = mkFx("r12rh"); rh.f("config", "remote.origin.url", HUB);
    const rhMain = rh.f("rev-parse", "HEAD");
    rh.f("checkout", "-q", "-b", "feat"); const rhFeat = rh.c("a.txt", "REAL unpushed work\n", "w"); rh.f("checkout", "-q", "main");
    const rhMarker = join(root, "r12rh-helper-ran");
    rh.f("config", `remote.${HUB}.url`, HUB); rh.f("config", `remote.${HUB}.vcs`, "rvfake");
    rh.f("config", "alias.remote-rvfake", `!f() { : > ${rhMarker}; while read -r c r; do case "$c" in capabilities) printf "fetch\\n\\n";; list) printf "${rhMain} refs/heads/main\\n${rhFeat} refs/heads/feat\\n\\n";; "") exit 0;; esac; done; }; f`);
    const rhScan = inCleanEnv(() => hubTransport(rh.w));
    const rhInRepo = inCleanEnv(() => gitRun(rh.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), unreachable); // the shape of a listing run INSIDE the repository
    const rhPrecondition = rhInRepo.ok && rhInRepo.stdout.includes(rhFeat) && readIfPresent(rhMarker) !== null;
    unlinkSync(rhMarker);
    const rhHere = process.cwd(); process.chdir(rh.w);
    let rhList; try { rhList = inCleanEnv(() => listHub(), unreachable); } finally { process.chdir(rhHere); }
    // ...and when the system temp directory is itself INSIDE the planted repository (the listing's empty directory is then below a repository): discovery must stop at the temp directory
    mkdirSync(join(rh.w, "tmp")); const rhInside = inCleanEnv(() => listHub(), { ...unreachable, TMPDIR: join(rh.w, "tmp") });
    const rhInsideRan = readIfPresent(rhMarker) !== null;
    check("a remote helper planted by repository configuration alone (remote.<Hub URL>.vcs plus an inline alias.remote-<vcs>) is named by the transport scan as a gated override, and the Hub listing, run where no repository's configuration reaches it, never runs the helper nor returns its fake listing (R12-helper)",
      rhPrecondition && rhScan.problems.some((p) => /^repository-scope remote\.https:\/\/github\.com\/DanFashauer\/SignalGrid-Review-Hub\.git\.vcs=rvfake \(local \.git\/config\)/.test(p)) &&
      rhScan.problems.some((p) => /^repository-scope alias\.remote-rvfake=\(not shown\) \(local \.git\/config\)/.test(p)) && rhScan.problems.some((p) => /\.url=https:\/\/github\.com\/DanFashauer\/SignalGrid-Review-Hub\.git \(local \.git\/config\)/.test(p)) &&
      readIfPresent(rhMarker) === null && !String(rhList.stdout).includes(rhFeat) && !rhInsideRan && !String(rhInside.stdout).includes(rhFeat));
    const rhRun = wholeScript(rh, "r12rh-e2e", unreachable);
    check("the whole check, in a repository carrying that configuration, exits 1 with a failing Hub-URL row that names the vcs and the alias, reads no listing, and never runs the helper (R12-helper-e2e)",
      rhRun.status === 1 && /✗ Review Hub URL\s+repository-scope remote\..*\.vcs=rvfake/.test(rhRun.out) && /alias\.remote-rvfake/.test(rhRun.out) && !/all present on the Review Hub/.test(rhRun.out) && readIfPresent(rhMarker) === null);
    const rhGlobal = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r12-global-helper.cfg", "[alias]\n\tremote-foo = !true\n[remote \"mirror\"]\n\tvcs = foo\n") });
    const rhEnv = withEnvVars({ GIT_EXEC_PATH: "/tmp/evil-exec", GIT_REMOTE_HELPER: "x", GIT_KEEP_ME: "y" }, () => gitEnv());
    const rhEnvScan = inCleanEnv(() => hubTransport(txc.w), { GIT_EXEC_PATH: "/tmp/evil-exec", GIT_REMOTE_HELPER: "x" });
    check("the same keys in the ENVIRONMENT's own configuration (the global file) are reported, not gated, and the caller's GIT_EXEC_PATH / GIT_REMOTE* never reach a git started here (R12-helper-env)",
      rhGlobal.problems.length === 0 && rhGlobal.trusted.some((t) => t.includes("alias.remote-foo=(not shown)")) && rhGlobal.trusted.some((t) => t.includes("remote.mirror.vcs=foo")) &&
      !("GIT_EXEC_PATH" in rhEnv) && !("GIT_REMOTE_HELPER" in rhEnv) && rhEnv.GIT_KEEP_ME === "y" && rhEnvScan.problems.length === 0 &&
      rhEnvScan.trusted.some((t) => t === "environment GIT_EXEC_PATH=/tmp/evil-exec (not passed to any git started here)") && rhEnvScan.trusted.some((t) => t.startsWith("environment GIT_REMOTE_HELPER=x")));
    // (5) core.sshCommand: a global ssh rewrite of the Hub (trusted) plus a planted repository core.sshCommand served a fake listing
    const ssx = mkFx("r12ss"); ssx.f("config", "remote.origin.url", HUB); ssx.f("config", "core.sshCommand", "/tmp/evil-ssh");
    const sshRewrite = cfgFile("r12-global-ssh.cfg", "[url \"ssh://git@github.com/\"]\n\tinsteadOf = https://github.com/\n");
    const ssScan = inCleanEnv(() => hubTransport(ssx.w), { GIT_CONFIG_GLOBAL: sshRewrite }), ssGlobal = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r12-global-sshcmd.cfg", "[core]\n\tsshCommand = ssh -i /home/u/key\n") });
    check("a repository-scope core.sshCommand is a gated transport override (the global ssh rewrite beside it is only reported), and the same key in the global file is reported (R12-sshcommand)",
      ssScan.problems.length === 1 && /^repository-scope core\.sshcommand=\/tmp\/evil-ssh \(local \.git\/config\)/.test(ssScan.problems[0]) && ssScan.trusted.some((t) => t.includes("rewrites the Hub URL to ssh://")) &&
      ssGlobal.problems.length === 0 && ssGlobal.trusted.some((t) => t.includes("core.sshcommand=ssh -i /home/u/key")));
    // (4) a credential inside a config KEY
    // The Hub here is a RESERVED host (.invalid never resolves): a fixture must not put a credential on a real host, and the checks below take the Hub URL from their argument, not from a literal.
    const keyToken = "ghp_R12SECRETTOKEN0123", keyPw = "pw0r12secret", keyHub = "https://hub.invalid/DanFashauer/SignalGrid-Review-Hub.git";
    const keyGlobal = cfgFile("r12-key-global.cfg", `[url "https://ci-bot:${keyToken}@hub.invalid/"]\n\tinsteadOf = https://hub.invalid/\n[http "https://user:${keyPw}@proxy.example/"]\n\tproxy = http://proxy.example:3128\n`);
    const keyScan = inCleanEnv(() => hubTransport(txc.w, keyHub), { GIT_CONFIG_GLOBAL: keyGlobal });
    const keyLocal = mkFx("r12kl"); keyLocal.f("config", "remote.origin.url", keyHub); keyLocal.f("config", `url.https://ci-bot:${keyToken}@hub.invalid/.insteadOf`, "https://hub.invalid/");
    const keyLocalScan = inCleanEnv(() => hubTransport(keyLocal.w, keyHub));
    const keyEvil = mkFx("r12ke"); keyEvil.f("config", "remote.origin.url", keyHub); keyEvil.f("config", `url.https://tok:${keyPw}@evil.example/.insteadOf`, "https://hub.invalid/");
    const keyEvilScan = inCleanEnv(() => hubTransport(keyEvil.w, keyHub));
    const keyRx = mkFx("r12kr"); keyRx.f("config", "remote.origin.url", keyHub); mkdirSync(join(keyRx.w, "docs")); writeFileSync(join(keyRx.w, "docs", "PURPOSE.md"), "fixture\n");
    const keyRun = wholeScript(keyRx, "r12kr-e2e", { GIT_CONFIG_GLOBAL: keyGlobal }, { hub: keyHub }); // (the script copy's Hub constant is the reserved host)
    const keyOrigin = inCleanEnv(() => originRow(keyRx.w, keyHub), { GIT_CONFIG_GLOBAL: keyGlobal });
    const keySsh = inCleanEnv(() => hubTransport(txc.w, keyHub), { GIT_CONFIG_GLOBAL: cfgFile("r13-global-ssh-hub.cfg", "[url \"git@hub.invalid:\"]\n\tinsteadOf = https://hub.invalid/\n") }); // a host-preserving rewrite of THIS Hub
    check("a token inside a url.<base> key (or a password inside an http.<url> key) is printed nowhere, a global insteadOf that only adds credentials to the Hub URL is no finding (no 'rewrites X to X'), and the whole check stays green with a warning row (R12-key-scrub)",
      keyScan.problems.length === 0 && !JSON.stringify(keyScan).includes(keyToken) && !JSON.stringify(keyScan).includes(keyPw) && keyScan.trusted.some((t) => t.includes("adds credentials to the Hub URL")) &&
      keyScan.trusted.some((t) => t.includes("url.https://hub.invalid/.insteadof=https://hub.invalid/")) && keyScan.trusted.some((t) => t.includes("http.https://proxy.example/.proxy=")) &&
      keyLocalScan.problems.length === 1 && !JSON.stringify(keyLocalScan).includes(keyToken) && /^repository-scope url\.https:\/\/hub\.invalid\/\.insteadof=https:\/\/hub\.invalid\/ \(local /.test(keyLocalScan.problems[0]) &&
      keyEvilScan.problems.length >= 2 && keyEvilScan.problems.some((p) => /rewrites the Hub URL .* to https:\/\/evil\.example\//.test(p)) && !JSON.stringify(keyEvilScan).includes(keyPw) &&
      keySsh.problems.length === 0 && keySsh.trusted.some((t) => t.includes("rewrites the Hub URL to git@hub.invalid:DanFashauer/SignalGrid-Review-Hub.git")) &&
      keyOrigin.state === "ok" && keyOrigin.detail === "https://hub.invalid/DanFashauer/SignalGrid-Review-Hub.git (remote.origin.url is https://hub.invalid/DanFashauer/SignalGrid-Review-Hub.git, rewritten by url.<base>.insteadOf)" && !JSON.stringify(keyOrigin).includes(keyToken) &&
      isHubUrl("git@hub.invalid:DanFashauer/SignalGrid-Review-Hub", keyHub) && !isHubUrl("https://github.com/DanFashauer/SignalGrid-Review-Hub", keyHub) && !isHubUrl("https://hub.invalid/DanFashauer/SignalGrid-Review-Hub", HUB) &&
      keyRun.status === 0 && !keyRun.out.includes(keyToken) && !keyRun.err.includes(keyToken) && !keyRun.out.includes(keyPw) && /! Review Hub transport/.test(keyRun.out) && !/✗ Review Hub URL/.test(keyRun.out));
    // (2) MAINLINE is anchored to the Hub's own listing: a hand-made refs/remotes/origin/main (porcelain only: merge --squash on a throwaway, update-ref, branch -D) cleared real unpushed work
    const fm = mkFx("r12fm"), fmBase = fm.f("rev-parse", "HEAD");
    const fmHonest = mainlineAnchor(fm.w, hubMapOf(fm.h), R6M);
    fm.f("checkout", "-q", "-b", "feat"); fm.c("a.txt", "REAL unpushed work\n", "w");
    fm.f("checkout", "-q", "-b", "throwaway", "main"); fm.f("merge", "-q", "--squash", "feat"); fm.f("commit", "-q", "-m", "forged squash"); const fmForged = fm.f("rev-parse", "HEAD");
    fm.f("update-ref", R6M, fmForged); fm.f("checkout", "-q", "main"); fm.f("branch", "-D", "throwaway");
    const fmRow = rowOf(fm.rows(), T_UNPUSHED), fmAnchor = mainlineAnchor(fm.w, hubMapOf(fm.h), R6M);
    check("a hand-made refs/remotes/origin/main that is not the Hub's main nor an ancestor of it does not turn real unpushed work into 'squash-landed': the exemptions are off, the row says so and says to fetch (R12-mainline-forged)",
      fmHonest.ok === true && hasLandedByContent("feat", R6M, fm.w) === true && fm.f("rev-parse", R6M) === fmForged && fmForged !== fmBase && fmAnchor.ok === false &&
      !!fmRow && fmRow.gated === true && fmRow.detail.startsWith("feat — push, or confirm the remote") && fmRow.detail.includes("squash-landed exemptions OFF: origin/main is not confirmed as the Hub's main") && fmRow.detail.includes("run git fetch origin, then re-run") && !/squash-landed, /.test(JSON.stringify(fm.rows())));
    const lgm = mkFx("r12lgm"), lgmBase = lgm.f("rev-parse", "HEAD"), lgmHub = hubAdvance(lgm, "main");
    const lgmUnfetched = mainlineAnchor(lgm.w, hubMapOf(lgm.h), R6M);
    lgm.f("fetch", "-q", "origin"); const lgmEqual = mainlineAnchor(lgm.w, hubMapOf(lgm.h), R6M);
    lgm.f("update-ref", R6M, lgmBase); const lgmLagging = mainlineAnchor(lgm.w, hubMapOf(lgm.h), R6M);
    check("the honest shapes stay anchored: the tracking ref equal to the Hub's main, and a LAGGING one (an ancestor of a Hub main that is in the store); the Hub's main not fetched is not anchored and the reason says to fetch (R12-mainline-anchor)",
      lgmUnfetched.ok === false && /is not fetched here: run git fetch origin, then re-run/.test(lgmUnfetched.reason) && lgmEqual.ok === true && lgm.f("rev-parse", R6M) === lgmBase && lgmLagging.ok === true && lgmHub.length === 40 &&
      mainlineAnchor(lgm.w, undefined, R6M).ok === false && mainlineAnchor(lgm.w, new Map(), R6M).ok === false && mainlineAnchor(lgm.w, hubMapOf(lgm.h), "refs/remotes/origin/nope").ok === false && mainlineAnchor(lgm.w, hubMapOf(lgm.h), "refs/heads/main").reason.includes("it is not a refs/remotes/origin/<name> ref"));
    const mf = mkForged("r12mf"); mf.f.f("update-ref", "refs/remotes/origin/other", mf.T); // a hand-made ref at unpushed work, "held" by the Hub's other only through a forged-name parent
    check("a hand-made mainline whose only link to the Hub's commit is a commit that does not hash to its name is not anchored: the chain is re-hashed (R12-mainline-chain)",
      localCommits(mf.f.w, [mf.H2]).has(mf.H2) && mf.f.f("merge-base", "--is-ancestor", mf.T, mf.H2).length === 0 && mainlineAnchor(mf.f.w, mf.map, "refs/remotes/origin/other").ok === false);
    // ...and the scratch declaration is read from mainline only while it is anchored
    const fs2 = mkFx("r12fs");
    fs2.f("checkout", "-q", "-b", "feat"); const fs2Tip = fs2.c("a.txt", "REAL unpushed work\n", "w"); fs2.f("checkout", "-q", "main");
    const fs2At = new Date((Number(fs2.f("log", "-1", "--format=%ct", "feat")) + 3600) * 1000).toISOString();
    fs2.f("checkout", "-q", "-b", "throwaway", "main"); mkdirSync(join(fs2.w, "docs", "agent"), { recursive: true });
    writeFileSync(join(fs2.w, SCRATCH_FILE), JSON.stringify([{ name: "feat", tip: fs2Tip, reason: "r", origin: "DR-050 gate-falsification reproduction", declaredBy: "t", declaredAt: fs2At }]));
    fs2.f("add", "-A"); fs2.f("commit", "-q", "-m", "forged mainline declaring feat scratch"); fs2.f("update-ref", R6M, fs2.f("rev-parse", "HEAD")); fs2.f("checkout", "-q", "main"); fs2.f("branch", "-D", "throwaway");
    const fs2Map = hubMapOf(fs2.h), fs2Old = evaluateScratch(R6M, fs2.w, ["main", "feat"]), fs2New = mainlineScratch(fs2.w, fs2Map, ["main", "feat"], R6M);
    check("a scratch declaration on a hand-made mainline excludes nothing: it is not read, and a warning row says so (the same declaration read from an anchored mainline still excludes the branch) (R12-scratch-forged)",
      fs2Old.excluded.join() === "feat" && fs2New.anchor.ok === false && fs2New.scratch.excluded.length === 0 && fs2New.scratch.exists === false && !!fs2New.row && fs2New.row.state === "warn" && fs2New.row.gated === false &&
      /^NOT read — origin\/main is not confirmed as the Hub's main/.test(fs2New.row.detail) && (() => { fs2.f("push", "-q", "-f", "origin", `${R6M}:refs/heads/main`); return mainlineScratch(fs2.w, hubMapOf(fs2.h), ["main", "feat"], R6M).scratch.excluded.join() === "feat"; })());
    // (3) a hand-made origin/<other> at the tip of an unfetched same-name branch with local commits
    const oz = mkFx("r12oz");
    oz.f("checkout", "-q", "-b", "X"); oz.c("x1.txt", "1\n", "x1"); oz.f("push", "-q", "origin", "X");
    const ozHub = hubAdvance(oz, "X"); execFileSync("git", ["-C", oz.h, "update-ref", "refs/heads/Z", ozHub], { env: FX_ENV }); // the Hub moves X and gains a Hub-only Z; this checkout fetches neither
    oz.c("x2.txt", "REAL unpushed\n", "x2");
    const ozHonest = rowOf(oz.rows(), T_AHEAD);
    oz.f("update-ref", "refs/remotes/origin/Z", "refs/heads/X");
    const ozPlanted = rowOf(oz.rows(), T_AHEAD), ozRows = oz.rows();
    oz.f("update-ref", "-d", "refs/remotes/origin/X");
    const ozNoTracking = rowOf(oz.rows(), T_AHEAD);
    // the branch's OWN tracking ref, hand-made at the tip (wave-78 review, p2b): Y exists on the Hub, the Hub moved it, this checkout fetched nothing, and origin/Y is written at the local tip
    const oy = mkFx("r16oy");
    oy.f("push", "-q", "origin", "main:refs/heads/Y"); oy.f("checkout", "-q", "-b", "Y"); oy.c("y1.txt", "REAL unpushed\n", "y1"); hubAdvance(oy, "Y");
    const oyHonest = rowOf(oy.rows(), T_AHEAD);
    oy.f("update-ref", "refs/remotes/origin/Y", "refs/heads/Y");
    const oyPlanted = rowOf(oy.rows(), T_AHEAD), oyRows = oy.rows();
    check("a hand-made refs/remotes/origin/Z at the tip, and one named like the branch itself, do not downgrade the gated 'unfetched same-name tip with local commits' to an ungated warning: only the Hub's own listing may (R12-origin-other)",
      !!oyHonest && oyHonest.gated === true && !!oyPlanted && oyPlanted.gated === true && oyPlanted.detail.startsWith("Y (+1 beyond the Hub's listed commits)") && !oyRows.some((r) => r.what === T_UNKNOWN && /Y/.test(r.detail)) && oy.f("rev-list", "--count", "refs/remotes/origin/Y..refs/heads/Y") === "0" &&
      !!ozHonest && ozHonest.gated === true && /^X \(\+\d+ beyond the Hub's listed commits\)/.test(ozHonest.detail) && !!ozPlanted && ozPlanted.gated === true && /^X \(\+\d+ beyond the Hub's listed commits\)/.test(ozPlanted.detail) &&
      !ozRows.some((r) => r.what === T_UNKNOWN && /X/.test(r.detail)) && !!ozNoTracking && ozNoTracking.gated === true && /^X \(\+\d+ beyond the Hub's listed commits\)/.test(ozNoTracking.detail));
    // (6) hermetic: the self-test isolates the developer's own git configuration for every fixture
    const hermProbe = mkFx("r12h");
    const hermGet = (k) => hermProbe.f("config", "--get", "--default", "", k);
    check("the self-test runs with an empty global git configuration and no system one for every fixture: fetch.prune and http.sslVerify of the developer's own configuration are not seen (R12-hermetic)",
      process.env.GIT_CONFIG_GLOBAL === emptyGlobalConfig && process.env.GIT_CONFIG_NOSYSTEM === "1" && !("GIT_SSL_NO_VERIFY" in process.env) && hermGet("fetch.prune") === "" && hermGet("http.sslverify") === "" && hermGet("merge.ff") === "");
    if (process.env.LOOP_STATE_SELFTEST_NESTED === "1") {
      check("(the hostile-configuration run is not nested a second time) (R12-hostile-global)", true);
    } else {
      const hostile = cfgFile("r12-hostile-global.cfg", "[fetch]\n\tprune = true\n[http]\n\tsslVerify = false\n[merge]\n\tff = only\n[core]\n\thooksPath = /nonexistent-hooks\n");
      const nested = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--self-test"], { encoding: "utf8", timeout: 900000, env: { ...process.env, GIT_CONFIG_GLOBAL: hostile, LOOP_STATE_SELFTEST_NESTED: "1" } });
      const nestedTail = String(nested.stdout).trim().split("\n").pop() || "";
      check("the whole self-test, started under a global git configuration that sets fetch.prune=true, http.sslVerify=false, merge.ff=only and a missing core.hooksPath, passes (R12-hostile-global)",
        nested.status === 0 && /^self-test passed \((\d+)\/\1\)$/.test(nestedTail));
    }
    // ══ ROUND 16 ══ Review round 2 (wave 78). (1) round 12's userinfo scrub read `https://evil.example?x=@github.com/<Hub>.git` as the Hub: the host of a URL is whatever the PARSER says.
    const evilShapes = [["?x=@", "https://evil.example?x=@github.com/"], ["#@", "https://evil.example#@github.com/"], ["backslash", "https://evil.example\\@github.com/"]]
      .map(([name, base]) => [name, `${base}DanFashauer/SignalGrid-Review-Hub.git`, base]); // [name, the Hub URL as the lure spells it, the url.<base> that rewrites https://github.com/ to it]
    check("a URL whose real host is another machine is not the Hub whatever it hides behind ?x=@, #@ or a backslash, and anything unparseable, with a query or fragment, of another scheme or port, is not the Hub; the real spellings, with credentials, are (R16-url-parse)",
      evilShapes.every(([, u]) => parseGitUrl(u) === null && isHubUrl(u) === false) && isHubUrl(["https://ci-bot:tok", "github.com/DanFashauer/SignalGrid-Review-Hub.git"].join("@")) && // (joined, so no line of this file carries a credential in front of a real host) isHubUrl("https://tok@github.com/danfashauer/signalgrid-review-hub/") &&
      isHubUrl("ssh://git@github.com/DanFashauer/SignalGrid-Review-Hub.git") && isHubUrl("git@github.com:DanFashauer/SignalGrid-Review-Hub") && !isHubUrl("git@GitHub.COM:DanFashauer/SignalGrid-Review-Hub.git") && !isHubUrl("https://GitHub.COM/DanFashauer/SignalGrid-Review-Hub.git") && !isHubUrl("ssh://git@github.com:22/DanFashauer/SignalGrid-Review-Hub.git") &&
      ["http://github.com/DanFashauer/SignalGrid-Review-Hub.git", "https://github.com:8443/DanFashauer/SignalGrid-Review-Hub.git", "https://github.com./DanFashauer/SignalGrid-Review-Hub.git", "git://github.com/DanFashauer/SignalGrid-Review-Hub.git", "file:///x/DanFashauer/SignalGrid-Review-Hub.git",
        "https://github.com/DanFashauer/SignalGrid-Review-Hub.git?x=1", "https://github.com/DanFashauer/SignalGrid-Review-Hub.git#frag", "https://github.com/DanFashauer/SignalGrid-Review-Hub.git extra",
        "https://github.com\\DanFashauer/SignalGrid-Review-Hub.git", "https://github.com/Dan\tFashauer/SignalGrid-Review-Hub.git", "https://github.com/DanFashauer/SignalGrid-Review-Hub.git\u0000", "https://github.com/DanFashauer/SignalGrid-\nReview-Hub.git", "git@github.com:/DanFashauer/SignalGrid-Review-Hub.git", "", "not a url"].every((u) => !isHubUrl(u)) &&
      noUserinfo("https://user:pw@host/p", true) === "https://host/p");
    const uo = mkFx("r16uo"); uo.f("config", "remote.origin.url", HUB);
    const uoFetch = evilShapes.map(([, u]) => { uo.f("remote", "set-url", "origin", u); return originRow(uo.w); });
    uo.f("remote", "set-url", "origin", HUB);
    const uoPush = evilShapes.map(([, u]) => { uo.f("remote", "set-url", "--push", "origin", u); return originRow(uo.w); });
    uo.f("remote", "set-url", "--push", "origin", HUB);
    // a hidden FETCH URL beside an honest push URL (the fetch URL is what the listing and every fetch would use)
    const uoSplit = evilShapes.map(([, u]) => { uo.f("remote", "set-url", "origin", u); uo.f("remote", "set-url", "--push", "origin", HUB); return originRow(uo.w); });
    uo.f("remote", "set-url", "origin", HUB);
    // The row's detail is "<fetch URL>" or "<fetch URL> (pushes to <push URL>)": each is parsed and its HOST compared for equality (a prefix or substring test on a host name is exactly the shape that lets another host follow it).
    const shownUrls = (detail) => {
      const m = /^(\S+)(?: \(pushes to (\S+)\))?$/.exec(detail);
      if (!m) return null;
      try { return { fetch: new URL(m[1]), push: m[2] ? new URL(m[2]) : null }; } catch { return null; }
    };
    const uoShown = [uoFetch, uoSplit, uoPush].map((rows) => rows.map((r) => shownUrls(r.detail)));
    check("the origin row FAILS for a fetch URL or a push URL that hides its real host behind ?x=@, #@ or a backslash (also when only one of the two does), and shows the real host instead of the Hub's name (R16-url-origin)",
      uoFetch.every((r, i) => r.state === "fail" && !!uoShown[0][i] && uoShown[0][i].push === null && uoShown[0][i].fetch.host === "evil.example") && !!uoShown[0][0] && uoShown[0][0].fetch.search === "?..." &&
      uoSplit.every((r, i) => r.state === "fail" && !!uoShown[1][i] && uoShown[1][i].fetch.host === "evil.example" && !!uoShown[1][i].push && uoShown[1][i].push.host === "github.com") &&
      uoPush.every((r, i) => r.state === "fail" && !!uoShown[2][i] && uoShown[2][i].fetch.host === "github.com" && uoShown[2][i].fetch.pathname === "/DanFashauer/SignalGrid-Review-Hub.git" && !!uoShown[2][i].push && uoShown[2][i].push.host === "evil.example") && originRow(uo.w).state === "ok");
    const urGlobal = (u) => cfgFile(`r16-global-${basename(u).length}-${Math.abs([...u].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}.cfg`, `[url ${JSON.stringify(u.replace(/\\/g, "\\\\"))}]\n\tinsteadOf = https://github.com/\n`);
    const urScans = evilShapes.map(([, , base]) => inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: urGlobal(base) }));
    const urRepo = mkFx("r16ur");
    const urLocals = evilShapes.map(([, , base]) => { urRepo.f("config", `url.${base}.insteadOf`, "https://github.com/"); const s = inCleanEnv(() => hubTransport(urRepo.w)); urRepo.f("config", "--unset", `url.${base}.insteadOf`); return s; });
    check("a global or repository-scope url.<base>.insteadOf whose base hides another host behind ?x=@, #@ or a backslash is a gated 'rewrites the Hub URL' finding naming the real host, never 'adds credentials', and nothing in the trusted list claims the Hub (R16-url-rewrite)",
      urScans.every((s) => s.problems.some((p) => /^git configuration rewrites the Hub URL .* to https:\/\/evil\.example\//.test(p)) && !s.trusted.some((t) => /adds credentials/.test(t))) &&
      urLocals.every((s) => s.problems.some((p) => /^git configuration rewrites the Hub URL .* to https:\/\/evil\.example\//.test(p)) && s.problems.some((p) => /^repository-scope url\./.test(p)) && !s.trusted.some((t) => /adds credentials/.test(t))));
    const ue = mkFx("r16ue"); ue.f("config", "remote.origin.url", HUB); mkdirSync(join(ue.w, "docs")); writeFileSync(join(ue.w, "docs", "PURPOSE.md"), "fixture\n");
    const ueRewrite = wholeScript(ue, "r16ue-a", { GIT_CONFIG_GLOBAL: urGlobal(evilShapes[0][2]) });
    const ue2 = mkFx("r16u2"); ue2.f("config", "remote.origin.url", HUB); mkdirSync(join(ue2.w, "docs")); writeFileSync(join(ue2.w, "docs", "PURPOSE.md"), "fixture\n"); ue2.f("remote", "set-url", "origin", evilShapes[1][1]);
    const ueOrigin = wholeScript(ue2, "r16u2-a");
    check("the whole check, with a global rewrite of the Hub to another host behind ?x=@ (a fake Hub that answers a listing is standing by), exits 1 with a failing Hub-URL row and never ASKS for the listing; with the origin hidden behind #@ it fails the origin row and exits 1 (R16-url-e2e)",
      ueRewrite.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL .* to https:\/\/evil\.example\//.test(ueRewrite.out) && !ueRewrite.listed && !/all present on the Review Hub/.test(ueRewrite.out) && !/adds credentials/.test(ueRewrite.out) &&
      ueOrigin.status === 1 && /✗ origin points at the Review Hub\s+https:\/\/evil\.example\//.test(ueOrigin.out));
    // The refuter's end-to-end shape: a fixture Hub that REALLY answers a listing, on a local port, reachable only through a rewrite that hides the real host behind ?x=@.
    // Precondition: the plain git, under that rewrite, reaches it. The whole check must then fail the Hub-URL row and never send it a request.
    const lpSha = hubMapOf(ue.h).get("main"), lpPort = join(root, "r16-hub.port"), lpLog = join(root, "r16-hub.log"), lpServer = join(root, "r16-hub-server.mjs");
    writeFileSync(lpLog, "");
    writeFileSync(lpServer, [`import { createServer } from "node:http"; import { appendFileSync, writeFileSync } from "node:fs";`,
      `const pkt = (s) => (s.length + 4).toString(16).padStart(4, "0") + s;`,
      `const body = pkt("# service=git-upload-pack\\n") + "0000" + pkt(process.argv[2] + " refs/heads/main\\0multi_ack thin-pack side-band side-band-64k ofs-delta shallow no-progress include-tag multi_ack_detailed symref=HEAD:refs/heads/main object-format=sha1 agent=fixture\\n") + "0000";`,
      `const srv = createServer((req, res) => { appendFileSync(process.argv[4], req.url + "\\n"); res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement", "cache-control": "no-cache" }); res.end(body); });`,
      `srv.listen(0, "127.0.0.1", () => writeFileSync(process.argv[3], String(srv.address().port)));`].join("\n") + "\n");
    const lpChild = spawn(process.execPath, [lpServer, lpSha, lpPort, lpLog], { detached: true, stdio: "ignore" }); // no shell, no command string: the program and its arguments are separate
    lpChild.on("error", () => { /* it never started: the port file never appears and the case fails below */ });
    lpChild.unref();
    const lpPid = lpChild.pid;
    let lpOk = false, lpListed = null, lpScan = null, lpWhole = null, lpAfter = null, lpPlain = null;
    try {
      for (let i = 0; i < 400 && readIfPresent(lpPort) === null; i++) spawnSync("sleep", ["0.05"]);
      const lpPortNo = readIfPresent(lpPort);
      if (lpPortNo !== null) {
        const lpBase = ["http://127.0.0.1:" + lpPortNo + "?x=", "github.com/"].join("@"); // (joined, so no line of this file spells a credential in front of a real host)
        const lpCfg = cfgFile("r16-localport-global.cfg", `[url ${JSON.stringify(lpBase)}]\n\tinsteadOf = https://github.com/\n`);
        const lpEnv = { NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1", HTTPS_PROXY: null, https_proxy: null, HTTP_PROXY: null, http_proxy: null, ALL_PROXY: null, all_proxy: null };
        lpPlain = inCleanEnv(() => gitRun(ue.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), { GIT_CONFIG_GLOBAL: lpCfg, ...lpEnv });
        lpListed = readIfPresent(lpLog);
        writeFileSync(lpLog, ""); // from here on, ANY request is the check's own
        lpScan = inCleanEnv(() => hubTransport(ue.w), { GIT_CONFIG_GLOBAL: lpCfg, ...lpEnv });
        lpWhole = wholeScript(ue, "r16lp-a", { GIT_CONFIG_GLOBAL: lpCfg, PATH: process.env.PATH, ...lpEnv });
        lpAfter = readIfPresent(lpLog);
        lpOk = true;
      }
    } finally { try { process.kill(lpPid); } catch { /* already gone */ } }
    check("a fixture Hub on a local port that answers a real listing, reached only through a global rewrite hiding the host behind ?x=@, is reachable by plain git (the precondition), is a gated 'rewrites the Hub URL' finding, and the whole check exits 1 without sending it one request (R16-url-localport)",
      lpOk && !!lpPlain && lpPlain.ok && lpPlain.stdout.includes(lpSha) && !!lpListed && lpListed.length > 0 &&
      !!lpScan && lpScan.problems.some((p) => /^git configuration rewrites the Hub URL .* to http:\/\/127\.0\.0\.1\/\?\.\.\. \(url\./.test(p)) &&
      !!lpWhole && lpWhole.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL/.test(lpWhole.out) && !lpWhole.out.includes("all present on the Review Hub") && lpAfter === "");
    // (3) listHub's isolation. Where it runs is probed (an empty directory made for the call, under the temp directory, with the ceiling set), and a rewrite written into .git/config AFTER the scan took its snapshot
    // (a shape no scan can see) is followed by a listing made inside the repository and not by listHub.
    const lhSeen = [], lhReal = gitRun;
    gitRun = (cwd2, args2, opts2 = {}) => {
      if (args2[0] === "ls-remote" && args2.includes("--heads")) {
        let entries = null; try { entries = readdirSync(cwd2); } catch { /* absent */ }
        lhSeen.push({ cwd: cwd2, entries, ceiling: opts2.env && opts2.env.GIT_CEILING_DIRECTORIES });
      }
      return lhReal(cwd2, args2, opts2);
    };
    try { inCleanEnv(() => listHub(), unreachable); } finally { gitRun = lhReal; }
    const lh = mkFx("r16lh"), lhFake = join(root, "r16-fakehub.git");
    execFileSync("git", ["init", "-q", "--bare", lhFake], { env: FX_ENV }); lh.f("push", "-q", lhFake, "main:refs/heads/fakeonly");

    const lhScan = inCleanEnv(() => hubTransport(lh.w)); // the scan's snapshot: clean
    lh.f("config", `url.file://${lhFake}.insteadOf`, HUB); // ...and only now the repository rewrites the Hub URL to a fake hub
    const lhHere = process.cwd(); process.chdir(lh.w);
    let lhIn, lhIso; try { lhIn = inCleanEnv(() => gitRun(lh.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), unreachable); lhIso = inCleanEnv(() => listHub(), unreachable); } finally { process.chdir(lhHere); }
    check("listHub runs in an empty directory made for the call under the temp directory, with GIT_CEILING_DIRECTORIES at it, and removes it (R16-listhub-where)",
      lhSeen.length === 1 && lhSeen[0].entries !== null && lhSeen[0].entries.length === 0 && dirname(lhSeen[0].cwd) === tmpdir() && /^loop-state-ls-[A-Za-z0-9]{6}$/.test(basename(lhSeen[0].cwd)) &&
      lhSeen[0].ceiling === realpathSync(tmpdir()) && lhSeen[0].cwd !== repo && lhSeen[0].cwd !== process.cwd() && !existsSync(lhSeen[0].cwd));
    check("a rewrite of the Hub URL written into .git/config after the scan's snapshot (a shape no scan enumerates) serves a fake listing to a listing made inside the repository and not to listHub (R16-listhub-isolation)",
      lhScan.problems.length === 0 && lhIn.ok && lhIn.stdout.includes("refs/heads/fakeonly") && !String(lhIso.stdout).includes("fakeonly") && !String(lhIso.stdout).includes(lh.f("rev-parse", "main")));
    // ══ ROUND 18 ══ Review round 3 (wave 88). (1) A URL is the Hub only with its scheme written as git reads it, and only as written. (2) A display prints less. (3) The ssh program of the environment.
    const caseShapes = ["HTTPS://github.com/DanFashauer/SignalGrid-Review-Hub.git", "Https://github.com/DanFashauer/SignalGrid-Review-Hub.git", "hTTps://github.com/DanFashauer/SignalGrid-Review-Hub.git",
      "SSH://git@github.com/DanFashauer/SignalGrid-Review-Hub.git", "Ssh://git@github.com/DanFashauer/SignalGrid-Review-Hub.git"];
    check("a URL is the Hub only when its scheme is written in lower case exactly as git reads it (HTTPS:// makes git run git-remote-HTTPS from PATH, SSH:// git-remote-SSH), and only as written: a leading or trailing blank makes it another URL (R18-scheme-parse)",
      caseShapes.every((u) => parseGitUrl(u) === null && isHubUrl(u) === false) && isHubUrl(HUB) && isHubUrl("ssh://git@github.com/DanFashauer/SignalGrid-Review-Hub.git") &&
      [" ", "\t", "\n"].every((b) => [`${b}${HUB}`, `${HUB}${b}`].every((u) => parseGitUrl(u) === null && isHubUrl(u) === false)));
    const csScans = ["HTTPS://github.com/", "SSH://git@github.com/", " https://github.com/"].map((base) => inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: urGlobal(base) }));
    const bo = mkFx("r18bo"); bo.f("config", "remote.origin.url", ` ${HUB}`);
    const boRow = originRow(bo.w);
    check("a global rewrite of the Hub to HTTPS://github.com/, to SSH://git@github.com/ or to a URL with a leading blank is a gated 'rewrites the Hub URL' finding that shows the scheme and the blank as written, never 'adds credentials'; an origin with a leading blank fails (R18-scheme-rewrite)",
      csScans.every((s) => !s.trusted.some((t) => /adds credentials|same host and repository/.test(t))) &&
      /^git configuration rewrites the Hub URL .* to HTTPS:\/\/github\.com\/DanFashauer\//.test(csScans[0].problems[0] || "") && /^git configuration rewrites the Hub URL .* to SSH:\/\/github\.com\/DanFashauer\//.test(csScans[1].problems[0] || "") &&
      /^git configuration rewrites the Hub URL .* to https:\/\/github\.com\/DanFashauer\/.* \(as written, with leading or trailing whitespace\)/.test(csScans[2].problems[0] || "") &&
      boRow.state === "fail" && boRow.detail.includes("(as written, with leading or trailing whitespace)"));
    // The refuter's end-to-end shape: git runs git-remote-HTTPS for HTTPS://. A helper of that name on PATH logs every call and answers a real listing. Precondition: plain git, under the rewrite, reaches it.
    const hxBin = join(root, "r18bin"), hxLog = join(root, "r18-helper.log"), hxSha = hubMapOf(ue.h).get("main");
    mkdirSync(hxBin); writeFileSync(hxLog, "");
    writeFileSync(join(hxBin, "git-remote-HTTPS"), String.raw`#!/bin/sh
echo "$@" >> "$R18_HELPER_LOG"
while read -r line; do
  case "$line" in
    capabilities) printf 'fetch\n\n' ;;
    list*) printf '%s refs/heads/main\n\n' "$R18_SHA" ;;
    "") exit 0 ;;
  esac
done
`, { mode: 0o755 });
    const hxVars = { GIT_CONFIG_GLOBAL: urGlobal("HTTPS://github.com/"), PATH: `${hxBin}:${process.env.PATH}`, R18_HELPER_LOG: hxLog, R18_SHA: hxSha };
    const hxPlain = inCleanEnv(() => gitRun(ue.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), hxVars);
    const hxCalled = readIfPresent(hxLog);
    writeFileSync(hxLog, ""); // from here on, ANY call is the check's own
    const hxWhole = wholeScript(ue, "r18hx", hxVars), hxAfter = readIfPresent(hxLog);
    check("a global rewrite to HTTPS://github.com/ with a git-remote-HTTPS helper on PATH that answers a listing: plain git reaches the helper (the precondition), and the whole check exits 1 on the gated rewrite row and never calls it (R18-scheme-e2e)",
      hxPlain.ok && hxPlain.stdout.includes(hxSha) && !!hxCalled && hxCalled.trim() !== "" &&
      hxWhole.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL .* to HTTPS:\/\/github\.com\//.test(hxWhole.out) && !hxWhole.out.includes("all present on the Review Hub") && !/adds credentials/.test(hxWhole.out) && hxAfter === "");
    // (2) A display prints less: everything before the LAST @ ahead of the next / is userinfo, whatever it holds.
    const SECRET = "sEcr3t", TAIL = "Z9", leaks = (t) => String(t).includes(SECRET) || String(t).includes(TAIL);
    const pwShapes = [["?", `http://agent:${SECRET}?${TAIL}@127.0.0.1:9`], ["#", `http://agent:${SECRET}#${TAIL}@127.0.0.1:9`], ["backslash", `http://agent:${SECRET}\\${TAIL}@127.0.0.1:9`], ["slash", `http://agent:${SECRET}/${TAIL}@127.0.0.1:9`]];
    check("a credential that holds a raw ?, # or backslash is not printed by the display helpers (noUserinfo with and without all, displayUrl), every URL of a string is scrubbed, a plain user name survives only where it is not asked to go, and an scp-style user:secret@host:path loses its userinfo (R18-display-unit)",
      pwShapes.every(([, u]) => noUserinfo(u, true) === "http://127.0.0.1:9" && noUserinfo(u) === "http://127.0.0.1:9" && displayUrl(u) === "http://127.0.0.1:9") &&
      displayUrl(`http://agent:12?${TAIL}@127.0.0.1:9`) === "http://agent/?..." && displayUrl("https://evil.example#frag/x") === "https://evil.example/#..." &&
      noUserinfo("url.https://a:b?c@h1/.insteadof=https://d:e#f@h2/", true) === "url.https://h1/.insteadof=https://h2/" &&
      noUserinfo("ssh://git@hub.invalid/x") === "ssh://git@hub.invalid/x" && noUserinfo("ssh://git@hub.invalid/x", true) === "ssh://hub.invalid/x" && noUserinfo("ssh://git:tok@hub.invalid/x") === "ssh://hub.invalid/x" &&
      [true, false].every((all) => noUserinfo(`user:${SECRET}@hub.invalid:Dan/x.git`, all) === "hub.invalid:Dan/x.git" && noUserinfo("tok3n@hub.invalid:Dan/x.git", all) === "hub.invalid:Dan/x.git" &&
        noUserinfo("git@hub.invalid:Dan/x.git", all) === "git@hub.invalid:Dan/x.git" && noUserinfo(`url.user:${SECRET}@hub.invalid:.insteadof`, all) === "url.hub.invalid:.insteadof" && noUserinfo("url.git@hub.invalid:.insteadof", all) === "url.git@hub.invalid:.insteadof") &&
      displayUrl(`user:${SECRET}@hub.invalid:Dan/SignalGrid-Review-Hub.git`) === "hub.invalid:Dan/SignalGrid-Review-Hub.git");
    const drvEnv = pwShapes.map(([, u]) => inCleanEnv(() => hubTransport(txc.w), { HTTPS_PROXY: u, https_proxy: u, ALL_PROXY: null, all_proxy: null }));
    const drvGlobal = pwShapes.map(([, u]) => inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile(`r18-proxy-${u.length}-${u.charCodeAt(u.indexOf(SECRET) + SECRET.length)}.cfg`, `[http]\n\tproxy = ${JSON.stringify(u)}\n`) }));
    const drp = mkFx("r18rp");
    const drvLocal = pwShapes.map(([, u]) => { drp.f("config", "http.proxy", u); return inCleanEnv(() => hubTransport(drp.w)); });
    const credHub = (cred) => ["https://" + cred, "github.com/DanFashauer/SignalGrid-Review-Hub.git"].join("@");
    const drvOrigin = [[`ci:${SECRET}?${TAIL}`], [`ci:${SECRET}#${TAIL}`], [`ci:${SECRET}\\${TAIL}`]].map(([cred]) => { bo.f("config", "remote.origin.url", credHub(cred)); return originRow(bo.w); });
    bo.f("config", "remote.origin.url", [`user:${SECRET}`, "github.com:DanFashauer/SignalGrid-Review-Hub.git"].join("@")); // (joined: no line of this file carries a credential in front of the Hub's host)
    const drvScp = originRow(bo.w);
    check("the rows built from a credential with a raw ?, # or backslash print none of it: the environment proxy, a global http.proxy, a repository-scope http.proxy finding, and an origin that is not the Hub as written (which says so, since it prints as the Hub) (R18-display-rows)",
      drvEnv.every((s) => s.note.includes("environment proxy HTTPS_PROXY/https_proxy=http://127.0.0.1:9") && !leaks(JSON.stringify(s))) &&
      drvGlobal.every((s) => s.problems.length === 0 && s.trusted.some((t) => t.includes("http.proxy=http://127.0.0.1:9")) && !leaks(JSON.stringify(s))) &&
      drvLocal.every((s) => s.problems.some((p) => /^repository-scope http\.proxy=http:\/\/127\.0\.0\.1:9 \(local /.test(p)) && !leaks(JSON.stringify(s))) &&
      drvOrigin.every((r) => r.state === "fail" && !leaks(r.detail) && !!shownUrls(r.detail.split(" (")[0]) && shownUrls(r.detail.split(" (")[0]).fetch.host === "github.com" && r.detail.includes("not the Hub as written")) &&
      drvScp.state === "fail" && !leaks(drvScp.detail) && drvScp.detail.startsWith("github.com:DanFashauer/SignalGrid-Review-Hub.git") && drvScp.detail.includes("not the Hub as written"));
    // (3) GIT_SSH_COMMAND, GIT_SSH and GIT_PROXY_COMMAND: reported in the row, never passed on.
    const sshVars = { GIT_SSH_COMMAND: "/x/evil-ssh -i /x/key", GIT_SSH: "/x/evil-ssh2", GIT_PROXY_COMMAND: "/x/evil-proxy --token t0k3n", GIT_KEEP_ME: "y" };
    const sshGitEnv = withEnvVars(sshVars, () => gitEnv()), sshScan = inCleanEnv(() => hubTransport(txc.w), sshVars);
    check("GIT_SSH_COMMAND, GIT_SSH and GIT_PROXY_COMMAND are named in the transport row as trusted-not-verified (a command by its program alone) and are absent from the environment of every git started here (R18-ssh-env)",
      ["GIT_SSH_COMMAND", "GIT_SSH", "GIT_PROXY_COMMAND"].every((k) => !(k in sshGitEnv)) && sshGitEnv.GIT_KEEP_ME === "y" && sshScan.problems.length === 0 &&
      sshScan.trusted.includes("environment GIT_SSH_COMMAND=/x/evil-ssh ... (not passed to any git started here)") && sshScan.trusted.includes("environment GIT_SSH=/x/evil-ssh2 (not passed to any git started here)") &&
      sshScan.trusted.includes("environment GIT_PROXY_COMMAND=/x/evil-proxy ... (not passed to any git started here)") && !JSON.stringify(sshScan).includes("t0k3n") && transportRow(sshScan).state === "warn");
    const sshMark = join(root, "r18-ssh-ran"), sshProg = join(root, "r18-ssh.sh"), sshHub = "ssh://r18.invalid/hub.git";
    writeFileSync(sshProg, `#!/bin/sh\n: > "${sshMark}"\nexit 1\n`, { mode: 0o755 });
    spawnSync("git", ["ls-remote", "--heads", sshHub], { env: { ...FX_ENV, GIT_SSH_COMMAND: sshProg, GIT_CONFIG_GLOBAL: hermetic.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 60000 });
    const sshRanPlain = readIfPresent(sshMark) !== null;
    rmSync(sshMark, { force: true });
    inCleanEnv(() => listHub(sshHub), { GIT_SSH_COMMAND: sshProg });
    check("an exported GIT_SSH_COMMAND is run by a plain git on an ssh URL (the precondition) and is never run by the listing (R18-ssh-listing)", sshRanPlain && readIfPresent(sshMark) === null);
    // ══ ROUND 19 ══ Review round 4 (wave 90). (1) git url-decodes an ssh:// URL before it splits off the host, the parser does not: a `%` in an authority is refused. (2) A scheme-less proxy and a password holding a `/`.
    const pctTail = "DanFashauer/SignalGrid-Review-Hub.git";
    const pctShapes = ["ssh://evil.example%2f@github.com/", "ssh://evil.example%40@github.com/", "ssh://evil.example%25@github.com/", "https://evil.example%2f@github.com/", "https://evil.example%40@github.com/",
      "https://evil.example%25@github.com/", "ssh://git@github%2ecom/", "https://github%2ecom/", "ssh://github.com%2f@github.com/"].map((b) => `${b}${pctTail}`);
    check("a % anywhere in the authority, for ssh:// and https://, in the userinfo or in the host, makes the URL not the Hub (git decodes it, the parser does not), while the plain spellings and a % in the path are judged as before (R19-pct-parse)",
      pctShapes.every((u) => parseGitUrl(u) === null && isHubUrl(u) === false) && isHubUrl(HUB) && isHubUrl(`ssh://git@github.com/${pctTail}`) && !isHubUrl(`ssh://evil.example/${pctTail}`) &&
      parseGitUrl(`https://github.com/${pctTail}`) !== null && parseGitUrl("https://github.com/DanFashauer/SignalGrid%2DReview-Hub.git") !== null);
    const pctBase = "ssh://evil.example%2f@github.com/", pctBaseHttps = "https://evil.example%2f@github.com/";
    const pcBin = join(root, "r19bin"), pcLog = join(root, "r19-ssh.log");
    mkdirSync(pcBin); writeFileSync(pcLog, "");
    writeFileSync(join(pcBin, "ssh"), String.raw`#!/bin/sh
echo "$@" >> "$R19_SSH_LOG"
exit 1
`, { mode: 0o755 });
    const pcVars = (base) => ({ GIT_CONFIG_GLOBAL: urGlobal(base), PATH: `${pcBin}:${process.env.PATH}`, R19_SSH_LOG: pcLog });
    const pcScans = [pctBase, pctBaseHttps, "ssh://evil.example/"].map((base) => inCleanEnv(() => hubTransport(ue.w), pcVars(base)));
    const pcPlain = inCleanEnv(() => gitRun(ue.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), pcVars(pctBase)), pcCalled = readIfPresent(pcLog);
    writeFileSync(pcLog, "");
    const pcWhole = wholeScript(ue, "r19pa", pcVars(pctBase)), pcAfter = readIfPresent(pcLog);
    const pcControl = wholeScript(ue, "r19pb", pcVars("ssh://evil.example/")), pcControlAfter = readIfPresent(pcLog);
    check("a global rewrite of the Hub to ssh://evil.example%2f@github.com/ (git runs ssh to evil.example) or its https twin is a gated 'rewrites the Hub URL' finding showing the base as written, never 'same host and repository'; the whole check exits 1 and the ssh on PATH is never called, and the honest ssh://evil.example/ control is gated too (R19-pct-rewrite)",
      /^git configuration rewrites the Hub URL .* to ssh:\/\/evil\.example%2f@github\.com\/DanFashauer\//.test(pcScans[0].problems[0] || "") && /^git configuration rewrites the Hub URL .* to https:\/\/evil\.example%2f@github\.com\/DanFashauer\//.test(pcScans[1].problems[0] || "") &&
      /^git configuration rewrites the Hub URL .* to ssh:\/\/evil\.example\/DanFashauer\//.test(pcScans[2].problems[0] || "") && pcScans.every((s) => !s.trusted.some((t) => /same host and repository|adds credentials/.test(t))) &&
      !pcPlain.ok && !!pcCalled && pcCalled.includes("evil.example") &&
      pcWhole.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL .* to ssh:\/\/evil\.example%2f@github\.com\//.test(pcWhole.out) && !pcWhole.out.includes("all present on the Review Hub") && pcAfter === "" &&
      pcControl.status === 1 && /✗ Review Hub URL/.test(pcControl.out) && pcControlAfter === "");
    const po = mkFx("r19po"), poHub = "https://github.com/DanFashauer/SignalGrid-Review-Hub.git";
    const poFetch = pctShapes.slice(0, 6).map((u) => { po.f("remote", "set-url", "origin", u); return [u, originRow(po.w)]; });
    po.f("remote", "set-url", "origin", HUB);
    const poPush = pctShapes.slice(0, 6).map((u) => { po.f("remote", "set-url", "--push", "origin", u); return [u, originRow(po.w)]; });
    check("an origin (fetch or push URL) with a % in its authority FAILS and prints the authority as written, with the host the parser would have shown nowhere in its place (R19-pct-origin)",
      poFetch.every(([u, r]) => r.state === "fail" && r.detail === u) && poPush.every(([u, r]) => r.state === "fail" && r.detail === `${poHub} (pushes to ${u})`));
    // (2) a scheme-less proxy with no port, and a password that holds a slash
    const bare = `agent:${SECRET}@127.0.0.1`;
    const blEnv = inCleanEnv(() => hubTransport(txc.w), { HTTPS_PROXY: bare, https_proxy: bare, ALL_PROXY: null, all_proxy: null });
    const blGlobal = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r19-bare-proxy.cfg", `[http]\n\tproxy = ${bare}\n`) });
    check("a scheme-less proxy value without a port (user:secret@host) and a password that holds a slash are not printed: noUserinfo with and without all, the environment proxy note and a global http.proxy (R19-display-bare)",
      [true, false].every((all) => noUserinfo(bare, all) === "127.0.0.1" && noUserinfo(`tok3n@127.0.0.1:3128`, all) === "127.0.0.1:3128" && noUserinfo(`http://agent:${SECRET}/${TAIL}@proxy.example:3128`, all) === "http://proxy.example:3128" && noUserinfo("git@hub.invalid:Dan/x.git", all) === "git@hub.invalid:Dan/x.git") &&
      noUserinfo("http://127.0.0.1:9/path and https://github.com/x", true) === "http://127.0.0.1:9/path and https://github.com/x" && noUserinfo("https://github.com/Dan/x@y", true) === "https://github.com/Dan/x@y" &&
      blEnv.note.includes("environment proxy HTTPS_PROXY/https_proxy=127.0.0.1") && !leaks(JSON.stringify(blEnv)) && blGlobal.trusted.some((t) => t.includes("http.proxy=127.0.0.1")) && !leaks(JSON.stringify(blGlobal)));
    // ══ ROUND 20 ══ Review round 5 (wave 92). The class: the parser and git read one authority two ways (scheme case, percent-escape, now a bracket). The rule is an allowlist on the raw authority.
    const GH = ["github", "com"].join("."); // (assembled: no line of this file spells a credential-shaped remote for the Hub's host)
    const hp20 = "DanFashauer/SignalGrid-Review-Hub.git";
    const nonHubAuthorities = [
      ...[`[evil.example]@${GH}`, `[evil.example]:22@${GH}`, `[::1]@${GH}`, `evil.example:22@${GH}`, `a@b@${GH}`, `git:x@${GH}`, `evil.example%2f@${GH}`, `git@${GH}:22`, `git@${GH.toUpperCase()}`,
        `git@${GH}.`, `${GH}`, `@${GH}`, "", ` git@${GH}`, `git@${GH} `, `GIT@${GH}`].map((a) => `ssh://${a}/${hp20}`),
      ...[`${GH}.`, `${GH.toUpperCase()}`, `${GH}:443`, ` ${GH}`, `[evil.example]@${GH}`, `[evil.example]:22@${GH}`, `[::1]@${GH}`, `a@b@${GH}`, `evil.example%2f@${GH}`, "", `user:p w@${GH}`,
        `u@${GH.replace(/^g/, "G")}`, `git@@${GH}`, `u:p:q@${GH}`, `evil.example:22@${GH}:443`].map((a) => `https://${a}/${hp20}`),
      ...[`[evil.example]@${GH}`, `[::1]@${GH}`, `a@b@${GH}`, `git:x@${GH}`, `evil.example:22@${GH}`, `${GH}`, `GIT@${GH}`, `git@${GH.toUpperCase()}`, `git@${GH}.`, ` git@${GH}`, "", `git@${GH} `].map((a) => `${a}:${hp20}`),
    ];
    const hubAuthorities = [`https://github.com/${hp20}`, `https://github.com/${hp20.replace(/\.git$/, "")}`, `ssh://git@github.com/${hp20}`, `ssh://git@github.com/${hp20.replace(/\.git$/, "")}`,
      `git@github.com:${hp20}`, `git@github.com:${hp20.replace(/\.git$/, "")}`, ["https://ci-bot:tok", `github.com/${hp20}`].join("@")];
    check("a URL is the Hub only when its raw authority is one of the Hub's own spellings (https: exactly the host, or a plain credential in front of it; ssh: exactly git@host; scp: exactly git@host before the colon): "
      + `${nonHubAuthorities.length} other authorities (brackets, ports, a second @, another user, case, a trailing dot, a blank, a percent, an empty one) are not the Hub, the exact spellings still are (R20-authority-allowlist)`,
      nonHubAuthorities.every((u) => isHubUrl(u) === false) && hubAuthorities.every((u) => isHubUrl(u) === true) && nonHubAuthorities.length >= 40 &&
      isHubUrl("https://hub.invalid/x/y.git", "https://hub.invalid/x/y.git") && !isHubUrl(`https://${GH}/x/y.git`, "https://hub.invalid/x/y.git") && isHubUrl("git@hub.invalid:x/y", "https://hub.invalid/x/y.git"));
    const brBases = [`ssh://[evil.example]@${GH}/`, `ssh://[evil.example]:22@${GH}/`, `ssh://[::1]@${GH}/`];
    const brScans = brBases.map((base) => inCleanEnv(() => hubTransport(ue.w), pcVars(base)));
    const brPlain = inCleanEnv(() => gitRun(ue.w, ["ls-remote", "--heads", HUB], { timeout: 60000 }), pcVars(brBases[0])), brCalled = readIfPresent(pcLog);
    writeFileSync(pcLog, "");
    const brWhole = wholeScript(ue, "r20pa", pcVars(brBases[0])), brAfter = readIfPresent(pcLog);
    check(`a global rewrite of the Hub to ssh://[evil.example]@${GH}/ (git reads the leading [ as an IPv6 bracket and runs ssh to evil.example), its :22 and [::1] twins, is a gated 'rewrites the Hub URL' finding showing the base as written; the whole check exits 1 and the ssh on PATH is never called (R20-bracket-rewrite)`,
      brScans.every((s, i) => s.problems.some((p) => p.startsWith("git configuration rewrites the Hub URL ") && p.includes(` to ${brBases[i].replace("]:22@", "]:***@")}${hp20} (url.`)) && !s.trusted.some((t) => /same host and repository|adds credentials/.test(t))) &&
      !brPlain.ok && !!brCalled && brCalled.includes("evil.example") && brWhole.status === 1 && /✗ Review Hub URL\s+git configuration rewrites the Hub URL .* to ssh:\/\/\[evil\.example\]@github\.com\//.test(brWhole.out) &&
      !brWhole.out.includes("all present on the Review Hub") && brAfter === "");
    const bo20 = mkFx("r20bo"), brOrigins = brBases.map((b) => `${b}${hp20}`);
    const brShown = (u) => u.replace("]:22@", "]:***@");
    const brFetch = brOrigins.map((u) => { bo20.f("remote", "set-url", "origin", u); return [u, originRow(bo20.w)]; });
    bo20.f("remote", "set-url", "origin", HUB);
    const brPush = brOrigins.map((u) => { bo20.f("remote", "set-url", "--push", "origin", u); return [u, originRow(bo20.w)]; });
    check("an origin (fetch or push URL) with a bracketed host in its userinfo FAILS and prints the authority as written, not the host the parser would have shown (R20-bracket-origin)",
      brFetch.every(([u, r]) => r.state === "fail" && r.detail === brShown(u)) && brPush.every(([u, r]) => r.state === "fail" && r.detail === `${poHub} (pushes to ${brShown(u)})`));
    // ══ ROUND 21 ══ Review round 6 (wave 95). The URL the gate judged was not the URL the listing fetched: the expansion and the scan ran in the repository, the listing in an empty directory.
    const mkLikeUe = (name) => { const fx = mkFx(name); fx.f("config", "remote.origin.url", HUB); mkdirSync(join(fx.w, "docs")); writeFileSync(join(fx.w, "docs", "PURPOSE.md"), "fixture\n"); return fx; };
    const im = mkLikeUe("r21im"), imReal = realpathSync(im.w), imTail = "SignalGrid-Review-Hub.git";
    const imMask = cfgFile("r21-mask.cfg", `[url ${JSON.stringify(HUB)}]\n\tinsteadOf = ${HUB}\n`);
    const imGlobal = cfgFile("r21-global-mask.cfg", `[includeIf "gitdir:${imReal}/"]\n\tpath = ${imMask}\n[url "ssh://evil.example/DanFashauer/"]\n\tinsteadOf = https://github.com/DanFashauer/\n`);
    const imVars = { GIT_CONFIG_GLOBAL: imGlobal, PATH: `${pcBin}:${process.env.PATH}`, R19_SSH_LOG: pcLog };
    writeFileSync(pcLog, "");
    const imInRepo = inCleanEnv(() => gitRun(im.w, ["ls-remote", "--get-url", HUB]), imVars).stdout.trim();
    const imInEmpty = inCleanEnv(() => inIsolatedDir((dir, isoEnv) => gitRun(dir, ["ls-remote", "--get-url", HUB], { env: isoEnv })), imVars).stdout.trim();
    inCleanEnv(() => inIsolatedDir((dir, isoEnv) => gitRun(dir, ["ls-remote", "--heads", HUB], { env: isoEnv, timeout: 60000 })), imVars);
    const imCalled = readIfPresent(pcLog);
    writeFileSync(pcLog, "");
    const imScan = inCleanEnv(() => hubTransport(im.w), imVars), imWhole = wholeScript(im, "r21im", imVars), imAfter = readIfPresent(pcLog);
    check("a global includeIf gitdir mask that makes the Hub URL expand to itself inside the repository, beside a shorter global rewrite that applies in an empty directory: plain git in the repository keeps the Hub, plain git in an empty directory reaches the fake ssh (the precondition); the scan names both expansions, the whole check exits 1 on that row and the fake is never called (R21-includeif-mask)",
      imInRepo === HUB && imInEmpty === `ssh://evil.example/DanFashauer/${imTail}` && !!imCalled && imCalled.includes("evil.example") &&
      imScan.problems.some((p) => p.startsWith(`git expands the Hub URL ${HUB} to ${HUB} in the repository but to ssh://evil.example/DanFashauer/${imTail} where the listing is read`)) &&
      imWhole.status === 1 && /✗ Review Hub URL\s+git expands the Hub URL .* in the repository but to ssh:\/\/evil\.example\//.test(imWhole.out) && !imWhole.out.includes("all present on the Review Hub") && imAfter === "");
    const ih = mkLikeUe("r21ih"), credBase = ["https://ci:tok", "github.com/"].join("@");
    const ihFile = cfgFile("r21-cred.cfg", `[url ${JSON.stringify(credBase)}]\n\tinsteadOf = https://github.com/\n`);
    const ihGlobal = cfgFile("r21-global-cred.cfg", `[includeIf "gitdir:${realpathSync(ih.w)}/"]\n\tpath = ${ihFile}\n`);
    const ihScan = inCleanEnv(() => hubTransport(ih.w), { GIT_CONFIG_GLOBAL: ihGlobal }), ihWhole = wholeScript(ih, "r21ih", { GIT_CONFIG_GLOBAL: ihGlobal });
    check("an includeIf that only adds a credential to the Hub URL inside the repository is still 'adds credentials (not shown)': no finding, the listing is read from the Hub, and the credential is never printed (R21-includeif-honest)",
      ihScan.problems.length === 0 && ihScan.trusted.includes("a url.<base>.insteadOf adds credentials to the Hub URL (not shown)") && !JSON.stringify(ihScan).includes("tok") && ihWhole.listed === true && !/✗ Review Hub URL/.test(ihWhole.out) && !ihWhole.out.includes("tok@"));
    const okExp = (x) => ({ ok: true, stdout: `${x}\n`, stderr: "", status: 0 }), badExp = { ok: false, stdout: "", stderr: "fatal: no\n", status: 128 };
    const evil1 = `ssh://evil.example/DanFashauer/${imTail}`, evil2 = `ssh://other.example/DanFashauer/${imTail}`, credHub21 = ["https://ci:tok", `github.com/DanFashauer/${imTail}`].join("@");
    const jEqual = judgeExpansions(okExp(HUB), okExp(HUB), HUB), jMask = judgeExpansions(okExp(HUB), okExp(evil1), HUB), jCred = judgeExpansions(okExp(credHub21), okExp(HUB), HUB);
    const jSame = judgeExpansions(okExp(evil1), okExp(evil1), HUB), jTwo = judgeExpansions(okExp(evil1), okExp(evil2), HUB), jIso = judgeExpansions(okExp(HUB), badExp, HUB), jRepo = judgeExpansions(badExp, okExp(HUB), HUB);
    check("the two expansions must agree: equal is silent; a credential in front of the same Hub on one side is the one difference allowed ('adds credentials'); anything else is a gated disagreement naming both, plus each expansion that is not the Hub; a failed expansion in either place is a finding that says where (R21-judge-unit)",
      jEqual.problems.length === 0 && jEqual.trusted.length === 0 &&
      jMask.problems.length === 2 && jMask.problems[0].includes(`to ${HUB} in the repository but to ${evil1} where the listing is read`) && jMask.problems[1].includes("rewrites the Hub URL") && jMask.problems[1].includes("read where the listing is") &&
      jCred.problems.length === 0 && jCred.trusted.length === 1 && jCred.trusted[0].includes("adds credentials") && !JSON.stringify(jCred).includes("tok") &&
      jSame.problems.length === 1 && jSame.problems[0].includes("rewrites the Hub URL") && jTwo.problems.length === 3 && jTwo.problems[1].includes(`to ${evil1} in the repository but to ${evil2} where`) &&
      jIso.problems.length === 1 && jIso.problems[0].startsWith("git could not expand the Hub URL where the listing is read") && jRepo.problems.length === 1 && jRepo.problems[0].startsWith("git could not expand the Hub URL (fatal: no)"));
    const stGlobal = inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r21-state.cfg", `[includeIf "onbranch:main"]\n\tpath = ${imMask}\n[includeIf "hasconfig:remote.*.url:*"]\n\tpath = ${imMask}\n[includeIf "gitdir:/nowhere/"]\n\tpath = ${imMask}\n`) });
    const stRepo = mkFx("r21st"); stRepo.f("config", "includeif.onbranch:main.path", imMask);
    const stLocal = inCleanEnv(() => hubTransport(stRepo.w));
    check("an includeIf whose condition depends on the state of the repository (onbranch, hasconfig) is named in the row when the environment carries it and is a gated finding when the repository does; a gitdir condition is not (the two expansions cover it) (R21-includeif-state)",
      stGlobal.problems.length === 0 && stGlobal.trusted.some((t) => t.includes('includeIf "onbranch:main"')) && stGlobal.trusted.some((t) => t.includes('includeIf "hasconfig:remote.*.url:*"')) && !stGlobal.trusted.some((t) => t.includes("gitdir")) &&
      stLocal.problems.some((p) => p.startsWith('repository-scope includeIf "onbranch:main"')));
    const pathBad = ["//DanFashauer/SignalGrid-Review-Hub.git", "/../DanFashauer/SignalGrid-Review-Hub.git", "/%2e%2e/DanFashauer/SignalGrid-Review-Hub.git", "/DanFashauer//SignalGrid-Review-Hub.git",
      "/DanFashauer/./SignalGrid-Review-Hub.git", "/x/../DanFashauer/SignalGrid-Review-Hub.git", "/DanFashauer/SignalGrid-Review-Hub.git/.", "/DanFashauer/SignalGrid-Review-Hub.git/..", "/DanFashauer/SignalGrid%2DReview-Hub.git",
      "/DanFashauer/SignalGrid-Review-Hub.git//", "/./DanFashauer/SignalGrid-Review-Hub.git", "/"].map((p) => `https://${GH}${p}`);
    check("the PATH is checked as written beside the authority: dot segments, doubled slashes and %-escapes on the Hub's own host are not the Hub, the plain /<owner>/<repo> spellings (with .git, without, with a trailing slash) are (R21-path-plain)",
      pathBad.every((u) => isHubUrl(u) === false) && [`https://${GH}/DanFashauer/SignalGrid-Review-Hub.git`, `https://${GH}/DanFashauer/SignalGrid-Review-Hub`, `https://${GH}/DanFashauer/SignalGrid-Review-Hub/`, `ssh://git@${GH}/DanFashauer/SignalGrid-Review-Hub.git`,
        `git@${GH}:DanFashauer/SignalGrid-Review-Hub.git`].every((u) => isHubUrl(u) === true) && !isHubUrl(`git@${GH}:/DanFashauer/SignalGrid-Review-Hub.git`) && !isHubUrl(`git@${GH}:DanFashauer/../DanFashauer/SignalGrid-Review-Hub.git`));
    // ══ ROUND 22 ══ Review round 7. (1) GIT_CONFIG: `git config` reads only that file, `git ls-remote` ignores it. (2) The listing-directory scan is load-bearing: a RELATIVE config path resolves differently there.
    // (3) A temp directory whose real path holds a ":" drops the ceiling.
    const gcFx = mkLikeUe("r22gc"), rcFx = mkLikeUe("r22rc");
    const px = join(root, "r22-proxy.mjs"), pxPort = join(root, "r22-proxy.port"), pxLog = join(root, "r22-proxy.log");
    writeFileSync(pxLog, "");
    writeFileSync(px, [`import { createServer } from "node:http"; import { appendFileSync, writeFileSync } from "node:fs";`,
      `const srv = createServer((req, res) => { appendFileSync(process.argv[3], "REQ " + req.url + "\\n"); res.writeHead(502); res.end(); });`,
      `srv.on("connect", (req, sock) => { appendFileSync(process.argv[3], "CONNECT " + req.url + "\\n"); sock.destroy(); });`,
      `srv.listen(0, "127.0.0.1", () => writeFileSync(process.argv[2], String(srv.address().port)));`].join("\n") + "\n");
    const pxChild = spawn(process.execPath, [px, pxPort, pxLog], { detached: true, stdio: "ignore" });
    pxChild.on("error", () => { /* it never started: the port file never appears and the cases fail below */ });
    pxChild.unref();
    const relDir = mkdtempSync(join(tmpdir(), "loop-state-r22rel-")), relBase = basename(relDir);
    const noProxyEnv = { HTTPS_PROXY: null, https_proxy: null, HTTP_PROXY: null, http_proxy: null, ALL_PROXY: null, all_proxy: null, NO_PROXY: null, no_proxy: null };
    let gcPlain = null, gcBlind = null, gcLogged = null, gcWhole = null, gcAfter = null, gcScan = null, rcScans = [], rcPlain = null, rcLogged = null, rcWhole = null, rcAfter = null;
    try {
      for (let i = 0; i < 400 && readIfPresent(pxPort) === null; i++) spawnSync("sleep", ["0.05"]);
      const pxNo = readIfPresent(pxPort);
      if (pxNo !== null) {
        const proxyCfg = `[http]\n\tproxy = http://127.0.0.1:${pxNo}\n\tsslVerify = false\n`;
        // (1) a global proxy + sslVerify=false, and GIT_CONFIG=/dev/null in the environment
        const gcCfg = cfgFile("r22-global-proxy.cfg", proxyCfg);
        const rawEnv = { ...FX_ENV, GIT_CONFIG_GLOBAL: gcCfg, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG: "/dev/null" };
        for (const k of Object.keys(noProxyEnv)) delete rawEnv[k];
        gcBlind = spawnSync("git", ["config", "--get-regexp", "^http\\."], { cwd: gcFx.w, env: rawEnv, encoding: "utf8" });
        gcPlain = spawnSync("git", ["ls-remote", "--heads", HUB], { cwd: root, env: rawEnv, encoding: "utf8", timeout: 60000 });
        gcLogged = readIfPresent(pxLog);
        writeFileSync(pxLog, "");
        const gcVars = { GIT_CONFIG_GLOBAL: gcCfg, GIT_CONFIG: "/dev/null", PATH: process.env.PATH, ...noProxyEnv };
        gcScan = inCleanEnv(() => hubTransport(gcFx.w), gcVars);
        gcWhole = wholeScript(gcFx, "r22gc", gcVars);
        gcAfter = readIfPresent(pxLog);
        // (2) a RELATIVE global config (and HOME, XDG_CONFIG_HOME) that names a file only beside the listing's directory
        mkdirSync(join(relDir, "home")); mkdirSync(join(relDir, "xdg", "git"), { recursive: true });
        writeFileSync(join(relDir, "rel.cfg"), proxyCfg); writeFileSync(join(relDir, "home", ".gitconfig"), proxyCfg); writeFileSync(join(relDir, "xdg", "git", "config"), proxyCfg);
        const relVars = [{ GIT_CONFIG_GLOBAL: `../${relBase}/rel.cfg` }, { GIT_CONFIG_GLOBAL: null, HOME: `../${relBase}/home` }, { GIT_CONFIG_GLOBAL: null, HOME: "/nonexistent-r22", XDG_CONFIG_HOME: `../${relBase}/xdg` }];
        rcScans = relVars.map((v) => inCleanEnv(() => hubTransport(rcFx.w), { ...noProxyEnv, ...v }));
        writeFileSync(pxLog, "");
        rcPlain = inCleanEnv(() => inIsolatedDir((dir, isoEnv) => gitRun(dir, ["ls-remote", "--heads", HUB], { env: isoEnv, timeout: 60000 })), { ...noProxyEnv, ...relVars[0] });
        rcLogged = readIfPresent(pxLog);
        writeFileSync(pxLog, "");
        rcWhole = wholeScript(rcFx, "r22rc", { ...relVars[0], PATH: process.env.PATH, ...noProxyEnv });
        rcAfter = readIfPresent(pxLog);
      }
    } finally { try { process.kill(pxChild.pid); } catch { /* already gone */ } rmSync(relDir, { recursive: true, force: true }); }
    const gcGit = withEnvVars({ GIT_CONFIG: "/dev/null", GIT_CONFIG_GLOBAL: "/x/g.cfg" }, () => gitEnv());
    check("GIT_CONFIG=/dev/null (git config reads only that file, git ls-remote ignores it) hides a global http.proxy + http.sslVerify=false from a plain `git config` and not from the check: GIT_CONFIG is dropped from every git started here and named in the row, the scan finds the sslVerify finding, the whole check exits 1 and the proxy sees no request (R22-gitconfig-env)",
      !!gcBlind && gcBlind.stdout.trim() === "" && !!gcPlain && !!gcLogged && gcLogged.includes("CONNECT") && !("GIT_CONFIG" in gcGit) && gcGit.GIT_CONFIG_GLOBAL === "/x/g.cfg" &&
      !!gcScan && gcScan.problems.some((p) => /^http\.sslverify=false \(global [^)]*\) turns TLS verification off$/.test(p)) && gcScan.trusted.includes("environment GIT_CONFIG=/dev/null (not passed to any git started here)") &&
      !!gcWhole && gcWhole.status === 1 && /✗ Review Hub URL\s+http\.sslverify=false \(global [^)]*\) turns TLS verification off/.test(gcWhole.out) && !gcWhole.out.includes("all present on the Review Hub") && gcAfter === "");
    check("a RELATIVE GIT_CONFIG_GLOBAL, HOME or XDG_CONFIG_HOME naming a proxy + sslVerify=false file that exists only beside the listing's directory is found by the scan of that directory (global scope named) and the whole check exits 1 without a request to the proxy; plain git in that directory does reach it (R22-relative-config)",
      rcScans.length === 3 && rcScans.every((s) => s.problems.some((p) => /^http\.sslverify=false \(global [^)]*\) turns TLS verification off$/.test(p))) && !!rcPlain && !!rcLogged && rcLogged.includes("CONNECT") &&
      !!rcWhole && rcWhole.status === 1 && /✗ Review Hub URL\s+http\.sslverify=false \(global /.test(rcWhole.out) && rcAfter === "");
    const colonDir = join(root, "r22:tmp"); mkdirSync(colonDir);
    const colonList = withEnvVars({ TMPDIR: colonDir }, () => listHub()), colonScan = withEnvVars({ TMPDIR: colonDir }, () => hubTransport(rcFx.w)), colonRan = withEnvVars({ TMPDIR: colonDir }, () => inIsolatedDir(() => "ran", () => "refused"));
    check("a temporary directory whose real path holds a ':' (GIT_CEILING_DIRECTORIES is colon-separated) is refused with a finding naming the path: the listing is not run, the expansion is a failed finding, nothing is created in it; an ordinary temp directory runs (R22-ceiling-colon)",
      colonList.ok === false && colonList.status === null && colonList.stderr.includes("refusing to run git in an isolated directory") && colonList.stderr.includes("r22:tmp") && readdirSync(colonDir).length === 0 && colonRan === "refused" &&
      colonScan.problems.some((p) => p.startsWith("git could not expand the Hub URL where the listing is read (refusing to run git in an isolated directory") && p.includes("r22:tmp")) && inIsolatedDir(() => "ran", () => "refused") === "ran");
    // ══ ROUND 23 ══ Review round 8. The scan read a config VALUE differently from git: (1) git_config_bool's grammar, (2) the tracing family, (3) the stated contract for a CA/proxy swap.
    const bv = (raw) => gitBoolValue(raw);
    const falseAll = ["", "0", "00", "0x0", "0X0", "-0x0", "-0", "+0", "0g", "0M", "000k", "false", "No", "OFF", " 0", "-0k"], trueAll = [null, "1", "0x1", "2k", "yes", "On", "true", "-1", "010", "1g", "+5", "0x10", "1K"];
    const badAll = ["maybe", "0z", "08", "0x", "k", "1.5", "--1", "9223372036854775808", "9223372036854775807k", "1kk", "tru", "0 0"];
    check("every boolean the scan judges is read with git_config_bool's grammar: text booleans, then an integer in base 0 (decimal, hex, octal, a sign, a leading blank) with an optional k/m/g suffix, zero false and non-zero true, anything else unparseable (R23-bool-unit)",
      falseAll.every((v) => bv(v) === false) && trueAll.every((v) => bv(v) === true) && badAll.every((v) => bv(v) === undefined));
    const bScopes = {
      global: (v) => ({ GIT_CONFIG_GLOBAL: cfgFile(`r23-bool-${Buffer.from(String(v)).toString("hex")}.cfg`, `[http]\n\tsslVerify = ${v}\n`) }),
      parameters: (v) => ({ GIT_CONFIG_PARAMETERS: `'http.sslverify'='${v}'` }),
      count: (v) => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.sslVerify", GIT_CONFIG_VALUE_0: v }),
    };
    const bScan = (scope, v) => inCleanEnv(() => hubTransport(txc.w), bScopes[scope](v));
    const sslRe = /^http\.sslverify=\S+ \((global [^)]*|command line)\) turns TLS verification off$/, badRe = /^http\.sslverify=\S+ \((global [^)]*|command line)\) is not a boolean git can read/;
    const bFalse = Object.keys(bScopes).map((sc) => ["00", "0x0", "-0", "+0", "0k"].map((v) => bScan(sc, v)));
    const bFalseMore = ["0X0", "-0x0", "0g", "0M", "000k"].map((v) => bScan("global", v));
    const bTrue = Object.keys(bScopes).map((sc) => ["1", "0x1", "2k"].map((v) => bScan(sc, v)));
    const bBad = Object.keys(bScopes).map((sc) => ["maybe", "0z"].map((v) => bScan(sc, v)));
    check("00, 0x0, -0, +0 and 0k (and 0X0, -0x0, 0g, 0M, 000k) as http.sslVerify gate with the sslverify finding at global scope and at command scope (GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT); 1, 0x1 and 2k count as true; 'maybe' and '0z' gate as not a boolean (R23-bool-scan)",
      bFalse.flat().every((s) => s.problems.some((p) => sslRe.test(p))) && bFalseMore.every((s) => s.problems.some((p) => sslRe.test(p))) && bTrue.flat().every((s) => !s.problems.some((p) => /sslverify/.test(p))) &&
      bBad.flat().every((s) => s.problems.some((p) => badRe.test(p)) && !s.problems.some((p) => sslRe.test(p))) &&
      inCleanEnv(() => hubTransport(txc.w), { GIT_CONFIG_GLOBAL: cfgFile("r23-psv.cfg", "[http]\n\tproxySSLVerify = 0x0\n") }).problems.some((p) => /^http\.proxysslverify=0x0 \(global [^)]*\) turns TLS verification off$/.test(p)));
    // end to end: a logging proxy; the listing would go through it if a switch were read as "on"
    const bpx = join(root, "r23-proxy.mjs"), bpxPort = join(root, "r23-proxy.port"), bpxLog = join(root, "r23-proxy.log");
    writeFileSync(bpxLog, "");
    writeFileSync(bpx, [`import { createServer } from "node:http"; import { appendFileSync, writeFileSync } from "node:fs";`,
      `const srv = createServer((req, res) => { appendFileSync(process.argv[3], "REQ " + req.url + "\\n"); res.writeHead(502); res.end(); });`,
      `srv.on("connect", (req, sock) => { appendFileSync(process.argv[3], "CONNECT " + req.url + "\\n"); sock.destroy(); });`,
      `srv.listen(0, "127.0.0.1", () => writeFileSync(process.argv[2], String(srv.address().port)));`].join("\n") + "\n");
    const bpxChild = spawn(process.execPath, [bpx, bpxPort, bpxLog], { detached: true, stdio: "ignore" });
    bpxChild.on("error", () => { /* it never started: the port file never appears and the case fails below */ });
    bpxChild.unref();
    const bxFx = mkLikeUe("r23bx");
    let bxPlain = null, bxLogged = null, bxGlobal = null, bxGlobalAfter = null, bxParams = null, bxParamsAfter = null;
    const bxNoProxy = { HTTPS_PROXY: null, https_proxy: null, HTTP_PROXY: null, http_proxy: null, ALL_PROXY: null, all_proxy: null, NO_PROXY: null, no_proxy: null };
    try {
      for (let i = 0; i < 400 && readIfPresent(bpxPort) === null; i++) spawnSync("sleep", ["0.05"]);
      const bpxNo = readIfPresent(bpxPort);
      if (bpxNo !== null) {
        const proxyUrl = `http://127.0.0.1:${bpxNo}`, bxCfg = cfgFile("r23-e2e.cfg", `[http]\n\tproxy = ${proxyUrl}\n\tsslVerify = 00\n`);
        const rawEnv = { ...FX_ENV, GIT_CONFIG_GLOBAL: bxCfg, GIT_CONFIG_NOSYSTEM: "1" };
        for (const k of Object.keys(bxNoProxy)) delete rawEnv[k];
        bxPlain = spawnSync("git", ["ls-remote", "--heads", HUB], { cwd: root, env: rawEnv, encoding: "utf8", timeout: 60000 });
        bxLogged = readIfPresent(bpxLog);
        writeFileSync(bpxLog, "");
        bxGlobal = wholeScript(bxFx, "r23bxa", { GIT_CONFIG_GLOBAL: bxCfg, PATH: process.env.PATH, ...bxNoProxy });
        bxGlobalAfter = readIfPresent(bpxLog);
        bxParams = wholeScript(bxFx, "r23bxb", { GIT_CONFIG_PARAMETERS: `'http.proxy'='${proxyUrl}' 'http.sslverify'='0x0'`, PATH: process.env.PATH, ...bxNoProxy });
        bxParamsAfter = readIfPresent(bpxLog);
      }
    } finally { try { process.kill(bpxChild.pid); } catch { /* already gone */ } }
    check("end to end, with a logging proxy: http.sslVerify=00 in the global file (plain git reaches the proxy, the precondition) and http.sslVerify=0x0 on the command line each make the whole check exit 1 on the sslverify finding with no request at the proxy (R23-bool-e2e)",
      !!bxPlain && !!bxLogged && bxLogged.includes("CONNECT") && !!bxGlobal && bxGlobal.status === 1 && /✗ Review Hub URL\s+http\.sslverify=00 \(global /.test(bxGlobal.out) && bxGlobalAfter === "" &&
      !!bxParams && bxParams.status === 1 && /✗ Review Hub URL\s+http\.sslverify=0x0 \(command line\) turns TLS verification off/.test(bxParams.out) && bxParamsAfter === "");
    // (2) the tracing family writes the listing's traffic to a file the caller names
    const trNames = ["GIT_TRACE", "GIT_TRACE2", "GIT_TRACE2_EVENT", "GIT_TRACE2_PERF", "GIT_TRACE_PACKET", "GIT_TRACE_CURL", "GIT_TRACE_SETUP", "GIT_TRACE_PERFORMANCE"];
    const trFiles = Object.fromEntries(trNames.map((k) => [k, join(root, `r23-${k}.out`)])), trVars = { ...trFiles, GIT_CURL_VERBOSE: "1" };
    const trPlain = spawnSync("git", ["ls-remote", "--heads", HUB], { cwd: root, env: { ...FX_ENV, ...trVars, HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", GIT_CONFIG_GLOBAL: hermetic.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", timeout: 60000 });
    const trPre = [trFiles.GIT_TRACE, trFiles.GIT_TRACE2_EVENT].map((f) => readIfPresent(f) !== null);
    for (const f of Object.values(trFiles)) rmSync(f, { force: true });
    const trGit = withEnvVars({ ...trVars, GIT_KEEP_ME: "y" }, () => gitEnv()), trScan = inCleanEnv(() => hubTransport(txc.w), trVars);
    inCleanEnv(() => { listHub(); originRow(txc.w); }, { ...trVars, ...unreachable });
    check("GIT_TRACE, GIT_TRACE2, GIT_TRACE2_EVENT, GIT_TRACE2_PERF, GIT_TRACE_PACKET, GIT_TRACE_CURL, GIT_TRACE_SETUP, GIT_TRACE_PERFORMANCE and GIT_CURL_VERBOSE are dropped from every git the check starts and named in the row: a plain git writes the trace files (the precondition), the check's gits write none (R23-trace-env)",
      trPlain.status !== undefined && trPre.every(Boolean) && trNames.every((k) => readIfPresent(trFiles[k]) === null) && [...trNames, "GIT_CURL_VERBOSE"].every((k) => !(k in trGit)) && trGit.GIT_KEEP_ME === "y" &&
      [...trNames, "GIT_CURL_VERBOSE"].every((k) => trScan.trusted.some((t) => t.startsWith(`environment ${k}=`) && t.endsWith("(not passed to any git started here)"))) && trScan.problems.length === 0);
    // (3) the contract: a CA bundle or proxy of the environment is named, trusted, and the row says it is not verified by design
    const caScan = inCleanEnv(() => hubTransport(txc.w), { SSL_CERT_FILE: "/x/ca1.pem", SSL_CERT_DIR: "/x/cadir", CURL_CA_BUNDLE: "/x/ca2.pem", GIT_CONFIG_GLOBAL: cfgFile("r23-ca.cfg", "[http]\n\tsslCAInfo = /x/swapped.pem\n\tproxy = http://127.0.0.1:9\n") });
    check("SSL_CERT_FILE, SSL_CERT_DIR and CURL_CA_BUNDLE are named like GIT_SSL_CAINFO, and a global http.sslCAInfo + proxy is trusted, not verified: no finding, and the warning row states that this is by design (R23-ca-contract)",
      caScan.problems.length === 0 && ["SSL_CERT_FILE=/x/ca1.pem", "SSL_CERT_DIR=/x/cadir", "CURL_CA_BUNDLE=/x/ca2.pem"].every((e) => caScan.trusted.includes(`environment CA ${e}`)) &&
      caScan.trusted.some((t) => t.includes("http.sslcainfo=/x/swapped.pem")) && transportRow(caScan).state === "warn" && transportRow(caScan).detail.includes("by design a proxy or CA bundle set by the environment's own configuration or command line") && transportRow(caScan).gated === false);
    // ══ ROUND 24 ══ Review round 9. (1) GIT_SHALLOW_FILE and the family of variables that redirect which file git reads state from. (2) The children the check spawns. (3) SSLKEYLOGFILE and the libcurl variables.
    const sh24 = mkFx("r24sh");
    const sh24O = sh24.c("f.txt", "v1\n", "O"); sh24.f("push", "-q", "origin", "main");
    sh24.f("checkout", "-q", "-b", "kside", sh24O); sh24.c("k.txt", "k\n", "K: side"); sh24.f("push", "-q", "origin", "kside");
    sh24.f("checkout", "-q", "main"); sh24.c("f.txt", "v2 FEATURE\n", "X: feature"); const sh24Z = sh24.c("f.txt", "v1\n", "Z: revert the feature");
    sh24.f("merge", "-q", "--no-edit", "--no-ff", "kside"); sh24.f("push", "-q", "origin", "main");
    sh24.f("checkout", "-q", "-b", "work", sh24Z); const sh24T1 = sh24.c("f.txt", "v2 FEATURE\n", "T1: LOCAL re-apply of the reverted feature");
    sh24.f("merge", "-q", "--no-edit", "--no-ff", "kside"); sh24.f("branch", "-D", "kside");
    const sh24Pre = reported(sh24.rows(), "work"), sh24Forged = cfgFile("r24-forged-shallow", `${sh24T1}\n`);
    const sh24Under = withEnvVars({ GIT_SHALLOW_FILE: sh24Forged }, () => ({ rows: sh24.rows(), content: hasLandedByContent("work", R6M, sh24.w), patch: landedByPatchId("work", R6M, sh24.w), bounds: shallowBounds(sh24.w, "refs/heads/work", R6M), scan: hubTransport(sh24.w) }));
    const sh24RawBounds = execFileSync("git", ["rev-list", "--count", `refs/heads/work..${R6M}`], { cwd: sh24.w, encoding: "utf8", env: FX_ENV }).trim() !== execFileSync("git", ["rev-list", "--count", `refs/heads/work..${R6M}`], { cwd: sh24.w, encoding: "utf8", env: { ...FX_ENV, GIT_SHALLOW_FILE: sh24Forged } }).trim();
    check("GIT_SHALLOW_FILE in the caller's environment, naming a forged shallow file that lists the branch's own re-apply commit, does not hide the real ancestry: a plain git's walk changes under it (the precondition), the check's gits ignore it, the work stays reported, nothing clears it as landed, and the row names the variable (R24-shallow-env)",
      sh24Pre && sh24RawBounds && reported(sh24Under.rows, "work") && sh24Under.content === false && sh24Under.patch === false && sh24Under.bounds.off === "" && sh24Under.bounds.exclude.length === 0 &&
      sh24Under.scan.trusted.some((t) => t === `environment GIT_SHALLOW_FILE=${sh24Forged} (not passed to any git started here)`));
    const redirectNames = ["GIT_SHALLOW_FILE", "GIT_INDEX_FILE", "GIT_INDEX_VERSION", "GIT_REPLACE_REF_BASE", "GIT_ATTR_SOURCE", "GIT_ATTR_GLOBAL", "GIT_ATTR_SYSTEM", "GIT_ATTR_NOSYSTEM", "GIT_QUARANTINE_PATH",
      "GIT_TEMPLATE_DIR", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_IMPLICIT_WORK_TREE", "GIT_REF_PARANOIA", "GIT_COMMIT_GRAPH_PARANOIA", "SSLKEYLOGFILE"];
    const tlsNames = ["GIT_PROXY_SSL_CAINFO", "GIT_PROXY_SSL_CAPATH", "GIT_PROXY_SSL_CERT", "GIT_PROXY_SSL_KEY", "GIT_SSL_CERT", "GIT_SSL_KEY", "GIT_SSL_CERT_TYPE", "GIT_SSL_KEY_TYPE", "GIT_SSL_VERSION", "GIT_SSL_CIPHER_LIST", "GIT_HTTP_PROXY_AUTHMETHOD", "CURL_SSL_BACKEND"];
    const redirectVars = Object.fromEntries(redirectNames.map((k) => [k, `/x/${k}`])), tlsVars = Object.fromEntries(tlsNames.map((k) => [k, `/x/${k}`]));
    const redGit = withEnvVars({ ...redirectVars, GIT_DIR: "/x/d", GIT_OBJECT_DIRECTORY: "/x/o", GIT_KEEP_ME: "y", GIT_SSL_CERT: "/x/GIT_SSL_CERT" }, () => gitEnv()), redExtra = withEnvVars(redirectVars, () => gitEnv({ GIT_INDEX_FILE: "/own/index", GIT_CEILING_DIRECTORIES: "/own/ceiling" }));
    const redScan = inCleanEnv(() => hubTransport(txc.w), { ...redirectVars, ...tlsVars });
    check("every variable that redirects which file or directory git reads state from (shallow, graft, index, replace base, attribute sources, quarantine, template, ceiling, discovery, paranoia) and SSLKEYLOGFILE is dropped from every git started here, the caller's own extra values still apply, and the row names them and the libcurl TLS variables (R24-env-redirect)",
      redirectNames.every((k) => !(k in redGit)) && !("GIT_DIR" in redGit) && !("GIT_OBJECT_DIRECTORY" in redGit) && redGit.GIT_KEEP_ME === "y" && redGit.GIT_SSL_CERT === "/x/GIT_SSL_CERT" &&
      redExtra.GIT_INDEX_FILE === "/own/index" && redExtra.GIT_CEILING_DIRECTORIES === "/own/ceiling" && redirectNames.filter((k) => k !== "GIT_INDEX_FILE" && k !== "GIT_CEILING_DIRECTORIES").every((k) => !(k in redExtra)) &&
      redirectNames.every((k) => redScan.trusted.includes(`environment ${k}=/x/${k} (not passed to any git started here)`)) && tlsNames.every((k) => redScan.trusted.includes(`environment TLS ${k}=/x/${k}`)) && redScan.problems.length === 0);
    // (2) the children: stand-ins for the gate scripts the check spawns, each running a git of its own
    const tcFx = mkLikeUe("r24tc");
    const stub = (body) => `import { execFileSync } from "node:child_process"; execFileSync("git", ["status"], { stdio: "ignore" }); ${body}\n`;
    for (const [name, body] of [["check-readiness-figure.mjs", `console.log(JSON.stringify({ headline: 90, floor: 80, target: [92, 95], a: 90, b: 90, c: 90 }));`], ["check-decision-vocabulary.mjs", ""], ["check-product-framing.mjs", ""], ["check-raised-hands.mjs", `console.log(JSON.stringify({ open: 0 }));`]]) {
      mkdirSync(join(tcFx.w, "scripts"), { recursive: true }); writeFileSync(join(tcFx.w, "scripts", name), stub(body));
    }
    const tcTrace = Object.fromEntries([...trNames, "SSLKEYLOGFILE"].map((k) => [k, join(root, `r24-${k}.out`)]));
    const tcRun = wholeScript(tcFx, "r24tc", { ...tcTrace, GIT_CURL_VERBOSE: "1" });
    check("the children the check spawns (the readiness figure, the doctrine gates, the raised-hands monitor) get the cleaned environment too: with every GIT_TRACE* variable and SSLKEYLOGFILE exported, the whole check, stand-in children included, leaves no trace or key-log file (R24-trace-children)",
      tcRun.status !== null && /Readiness \(gates outreach\)/.test(tcRun.out) && /Decision vocabulary\s+green/.test(tcRun.out) && /Raised hands\s+none open/.test(tcRun.out) && Object.values(tcTrace).every((f) => readIfPresent(f) === null));
    // ══ ROUND 25 ══ Review round 10. (1) A graft on every path that reads ancestry to clear work. (2) A git that FAILS is not "nothing to report". (3) The audit's table lives in the header.
    const T_DET = "Detached HEAD work not on the Review Hub";
    const gd = mkFx("r25gd"); gd.c("a.txt", "1\n", "base"); gd.f("push", "-q", "origin", "main");
    const gdL = gd.f("rev-parse", "HEAD"), gdX = ctOf(gd, gd.f("rev-parse", "HEAD^{tree}"), "X: unpushed orphan work"); gd.f("checkout", "-q", "--detach", gdX);
    const gdPre = rowOf(gd.rows(), T_DET), gdGraftLine = `${gdL} ${gdX}\n`, gdGraftsPath = join(gd.w, ".git", "info", "grafts"), gdOuter = cfgFile("r25-graft-outer", gdGraftLine);
    const gdCount = (env) => execFileSync("git", ["rev-list", "--count", gdX, `^${gdL}`], { cwd: gd.w, encoding: "utf8", env: { ...FX_ENV, ...env } }).trim();
    mkdirSync(join(gd.w, ".git", "info"), { recursive: true }); writeFileSync(gdGraftsPath, gdGraftLine);
    const gdFile = { raw: gdCount({}), row: rowOf(gd.rows(), T_DET) }; rmSync(gdGraftsPath);
    const gdEnv = withEnvVars({ GIT_GRAFT_FILE: gdOuter }, () => ({ raw: gdCount({ GIT_GRAFT_FILE: gdOuter }), row: rowOf(gd.rows(), T_DET) }));
    check("a graft line that makes the Hub's mainline commit a child of unpushed detached work hides it from a plain count (the precondition) but not from the check: the detached-HEAD row stays a GATED failure and names the graft file, for .git/info/grafts and for GIT_GRAFT_FILE (R25-graft-detached)",
      !!gdPre && gdPre.gated === true && gdCount({}) === "1" && gdFile.raw === "0" && gdEnv.raw === "0" &&
      !!gdFile.row && gdFile.row.state === "fail" && gdFile.row.gated === true && gdFile.row.detail.includes("graft file present") && gdFile.row.detail.includes(gdGraftsPath) &&
      !!gdEnv.row && gdEnv.row.state === "fail" && gdEnv.row.gated === true && gdEnv.row.detail.includes("graft file present") && gdEnv.row.detail.includes(gdOuter));
    const gs = mkFx("r25gs");
    gs.f("checkout", "-q", "-b", "feat"); gs.c("f1.txt", "1\n"); gs.f("push", "-q", "-u", "origin", "feat");
    const gsT = gs.c("mine.txt", "REAL local-only work\n", "local only"); hubAdvance(gs, "feat");
    const gsM = hubMapOf(gs.h).get("main"), gsLine = `${gsM} ${gsT}\n`, gsGrafts = join(gs.w, ".git", "info", "grafts"), gsOuter = cfgFile("r25-graft-samename", gsLine);
    const gsCount = (env) => execFileSync("git", ["rev-list", "--count", gsT, `^${gsM}`], { cwd: gs.w, encoding: "utf8", env: { ...FX_ENV, ...env } }).trim();
    const gsPre = rowOf(gs.rows(), T_AHEAD);
    mkdirSync(join(gs.w, ".git", "info"), { recursive: true }); writeFileSync(gsGrafts, gsLine);
    const gsFile = { raw: gsCount({}), row: rowOf(gs.rows(), T_AHEAD), warn: rowOf(gs.rows(), T_UNKNOWN) }; rmSync(gsGrafts);
    const gsEnv = withEnvVars({ GIT_GRAFT_FILE: gsOuter }, () => ({ raw: gsCount({ GIT_GRAFT_FILE: gsOuter }), row: rowOf(gs.rows(), T_AHEAD), warn: rowOf(gs.rows(), T_UNKNOWN) }));
    check("a same-named branch whose Hub tip is not fetched, with a graft that makes a Hub-listed commit a child of its tip: a plain count reads 0 (the precondition), and the row stays a GATED 'ahead' naming the graft file, never the quiet 'not fetched' warning, for .git/info/grafts and GIT_GRAFT_FILE (R25-graft-samename)",
      !!gsPre && gsPre.gated === true && /^feat \(\+\d+ beyond the Hub's listed commits\)/.test(gsPre.detail) && gsFile.raw === "0" && gsEnv.raw === "0" &&
      !!gsFile.row && gsFile.row.state === "fail" && gsFile.row.gated === true && /feat \(count unreadable\)/.test(gsFile.row.detail) && gsFile.row.detail.includes("graft file present") && gsFile.row.detail.includes(gsGrafts) && !gsFile.warn &&
      !!gsEnv.row && gsEnv.row.state === "fail" && gsEnv.row.gated === true && /feat \(count unreadable\)/.test(gsEnv.row.detail) && gsEnv.row.detail.includes("graft file present") && gsEnv.row.detail.includes(gsOuter) && !gsEnv.warn);
    // the primitives themselves refuse under a graft, so a caller that forgets the guard is still safe (defence in depth behind the two paths above)
    const gp = { tip: gsM, hubMap: new Map([["main", gsM]]) }, gpMain = "refs/remotes/origin/main";
    const gpClean = { reach: tipReachableFromAny(gs.w, gp.tip, [gp.tip]), chain: chainIsReal(gs.w, gp.tip, [gp.tip]), anchor: mainlineAnchor(gs.w, gp.hubMap, gpMain), held: commitsNotHeldBy(gs.w, `refs/heads/feat`, [gsM]) };
    writeFileSync(gsGrafts, gsLine);
    const gpGraft = { reach: tipReachableFromAny(gs.w, gp.tip, [gp.tip]), chain: chainIsReal(gs.w, gp.tip, [gp.tip]), anchor: mainlineAnchor(gs.w, gp.hubMap, gpMain), held: commitsNotHeldBy(gs.w, `refs/heads/feat`, [gsM]) }; rmSync(gsGrafts);
    check("under a graft file every primitive that reads ancestry to clear work refuses by itself: tipReachableFromAny reads unknown, chainIsReal false, mainlineAnchor is off with the file named, commitsNotHeldBy cannot count and names it; without one they answer (R25-graft-primitives)",
      gpClean.reach === true && gpClean.chain === true && gpClean.anchor.ok === true && Number.isInteger(gpClean.held.count) &&
      gpGraft.reach === null && gpGraft.chain === false && gpGraft.anchor.ok === false && gpGraft.anchor.reason.includes("graft file present") && gpGraft.held.count === null && gpGraft.held.unproven.includes(gsGrafts));
    // (2) a git that fails
    const hu = mkFx("r25hu"); hu.c("a.txt", "1\n", "base"); hu.f("push", "-q", "origin", "main"); hu.f("checkout", "-q", "--detach");
    writeFileSync(join(hu.w, ".git", "HEAD"), "1234567890123456789012345678901234567890\n");
    const huRow = rowOf(hu.rows(), T_DET);
    check("a detached HEAD that git cannot name (a sha that is in no object store) is a GATED failure saying HEAD is unreadable and why, never 'no detached work' (R25-head-unreadable)",
      !!huRow && huRow.state === "fail" && huRow.gated === true && huRow.detail.startsWith("HEAD is detached and unreadable: ") && huRow.detail.includes("unknown is not clean"));
    const mm = mkFx("r25mm"); mm.c("a.txt", "1\n", "base"); mm.f("push", "-q", "origin", "main"); mm.f("checkout", "-q", "--detach"); mm.c("d.txt", "REAL work on a detached HEAD\n", "detached work");
    mm.f("gc", "-q"); // (a packed repository: the mmap cap bites on pack windows)
    const mmPlain = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mm.w, encoding: "utf8", env: { ...FX_ENV, GIT_ALLOC_LIMIT: "1k" } });
    const mmPlain2 = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: mm.w, encoding: "utf8", env: { ...FX_ENV, GIT_MMAP_LIMIT: "1k" } });
    const mmRun = wholeScript(mm, "r25mm", { GIT_MMAP_LIMIT: "1k", GIT_ALLOC_LIMIT: "1k" });
    check("GIT_ALLOC_LIMIT=1k (rev-parse) and GIT_MMAP_LIMIT=1k (rev-list, on a packed repository) in the caller's environment make a plain git fail (the precondition) and do not silence the detached-HEAD row: the check's gits ignore them, the work is reported as a GATED failure (R25-caps-env)",
      mmPlain.status !== 0 && mmPlain2.status !== 0 && mmRun.status === 1 && /✗ Detached HEAD work not on the Review Hub\s+HEAD \(detached at [0-9a-f]{12}\) carries 1 commit\(s\)/.test(mmRun.out) &&
      !("GIT_MMAP_LIMIT" in withEnvVars({ GIT_MMAP_LIMIT: "1k", GIT_ALLOC_LIMIT: "1k", GIT_DIFF_OPTS: "-u0", GIT_KEEP_ME: "y" }, () => gitEnv())) && !("GIT_ALLOC_LIMIT" in withEnvVars({ GIT_ALLOC_LIMIT: "1k" }, () => gitEnv())) &&
      !("GIT_DIFF_OPTS" in withEnvVars({ GIT_DIFF_OPTS: "-u0" }, () => gitEnv())) && withEnvVars({ GIT_KEEP_ME: "y" }, () => gitEnv()).GIT_KEEP_ME === "y" &&
      ["GIT_MMAP_LIMIT", "GIT_ALLOC_LIMIT", "GIT_DIFF_OPTS"].every((k) => inCleanEnv(() => hubTransport(txc.w), { [k]: "1k" }).trusted.includes(`environment ${k}=1k (not passed to any git started here)`)));
    const wt = mkLikeUe("r25wt"); writeFileSync(join(wt.w, ".git", "index"), "this is not an index\n");
    const wtRun = wholeScript(wt, "r25wt", {});
    check("a git that fails while the working tree is read is a GATED 'could not be read' row, never 'clean' (a corrupt index: git status exits 128) (R25-status-failure)",
      wtRun.status === 1 && /✗ Working tree\s+could not be read \(git status failed: /.test(wtRun.out) && !/✓ Working tree\s+clean/.test(wtRun.out));
    // ══ ROUND 15 ══ CodeQL js/insecure-temporary-file: reappliesExactly's throwaway index had a predictable name made of the pid and the time, created directly in the shared temp directory.
    // The probe wraps gitRun (a module function, restored in the finally) and records the GIT_INDEX_FILE every git call is handed, and what that file's directory looked like AT THAT MOMENT.
    const ixSeen = [], realGitRun = gitRun;
    gitRun = (cwd2, args2, opts2 = {}) => {
      const idx2 = opts2.env && opts2.env.GIT_INDEX_FILE;
      if (idx2) {
        let st = null; try { st = statSync(dirname(idx2)); } catch { /* absent */ }
        ixSeen.push({ idx: idx2, dir: dirname(idx2), mode: st ? st.mode & 0o777 : null, isDir: st ? st.isDirectory() : false });
      }
      return realGitRun(cwd2, args2, opts2);
    };
    let ixGood, ixBadParent, ixBadPatch, ixDone = false;
    try {
      const ixSquash = ap.f("rev-parse", R6M), ixPatch = commitDiff(ap.w, ap.f("merge-base", R6M, "refs/heads/feat"), ap.f("rev-parse", "refs/heads/feat"));
      ixGood = reappliesExactly(ap.w, apP, ixPatch, ixSquash); // reads the tree, applies the patch, writes a tree: the success path
      ixBadParent = reappliesExactly(ap.w, "1".repeat(40), ixPatch, ixSquash); // read-tree fails: an early return
      ixBadPatch = reappliesExactly(ap.w, apP, "this is not a patch\n", ixSquash); // apply fails: another early return
      ixDone = true;
    } finally { gitRun = realGitRun; }
    const ixDirs = [...new Set(ixSeen.map((e) => e.dir))];
    check("reappliesExactly puts its throwaway index in a fresh mkdtemp directory of its own (an unpredictable name under the temp directory, mode 0700, the index inside it), on the success path and on both early returns, and removes that directory whatever the outcome (R15-tmp-index)",
      ixDone && ixGood === true && ixBadParent === false && ixBadPatch === false && ixDirs.length === 3 &&
      ixSeen.every((e) => basename(e.idx) === "index" && dirname(e.dir) === tmpdir() && /^loop-state-idx-[A-Za-z0-9]{6}$/.test(basename(e.dir)) && e.isDir && e.mode === 0o700) &&
      ixDirs.every((d) => !existsSync(d)) && !ixSeen.some((e) => basename(e.dir).includes(String(process.pid))));
    // ══ ROUND 14 ══ The walker-floor meta-gate flagged a list named like a walk root beside a readdirSync (a name-only match). Nothing here walks that list, so the name is gone; the list's shrinkage would silently loosen the
    // origin-inside-the-repository rule, so it has a floor, and the one real directory read in the self-test must have read something.
    const flNone = join(root, "r14-not-a-repository"); mkdirSync(flNone);
    const flScan = inCleanEnv(() => hubTransport(flNone));
    const flOwn = repoOwnership(txc.w);
    check("a directory that is no repository (git can name none of its own paths) is a gated finding, where a repository names at least its worktree and its git directory (R14-owned-floor)",
      flScan.problems.some((p) => /^git could not name the repository's own paths/.test(p)) && repoOwnership(flNone).owned.length === 0 && flOwn.owned.length >= 2 && flOwn.owned.every((p) => isAbsolute(p)) &&
      inCleanEnv(() => hubTransport(txc.w)).problems.length === 0);
    // fail-closed: a branch identical to mainline proves nothing
    check("a branch with no diff against mainline is not cleared", landedByPatchId("main", M, work) === false);
    // STATE freshness (pure, clock-free): a fixture date older than a fixture commit
    check("STATE trailing mainline by >7 days is stale", stateFreshness("2026-09-01", "2026-09-22T10:00:00-04:00").kind === "stale");
    check("STATE within a week reads fresh", stateFreshness("2026-09-20", "2026-09-22T10:00:00-04:00").kind === "fresh");
    check("an unparseable STATE date reads no-date, never fresh", stateFreshness("not-a-date", "2026-09-22T10:00:00-04:00").kind === "no-date");
    check("an unfetched remote reads no-remote, never fresh", stateFreshness("2026-09-20", "").kind === "no-remote");
    // DECLARED SCRATCH. The declaration is read from a MAINLINE ref, never the working tree; a branch is
    // excluded only while its tip equals the declared tip. Each case below fails when its guard is removed.
    const SF = SCRATCH_FILE;
    const decl = (name, at, tip) => ({ name, tip, reason: "r", origin: "DR-050 gate-falsification reproduction", declaredBy: "t", declaredAt: at });
    const rawNow = Number(g("log", "-1", "--format=%ct", "same"));
    const futureAt = new Date((rawNow + 3600) * 1000).toISOString(), pastAt = new Date((rawNow - 3600) * 1000).toISOString();
    const mkMainline = (name, text) => { // a throwaway "mainline" ref whose tree carries (or lacks) the declaration
      sh("checkout", "-q", "-b", name, "main");
      if (text !== null) { execFileSync("mkdir", ["-p", join(work, "docs/agent")]); put(SF, text); sh("add", "-A"); sh("commit", "-q", "-m", name); }
    };
    sh("checkout", "-q", "-b", "scratch-ok", "main"); put("s.txt", "x\n"); sh("add", "-A"); sh("commit", "-q", "-m", "scratch work");
    const tipOk = g("rev-parse", "scratch-ok");
    sh("checkout", "-q", "-b", "undeclared", "main"); put("u.txt", "x\n"); sh("add", "-A"); sh("commit", "-q", "-m", "undeclared work");
    const local = ["scratch-ok", "undeclared", "main"];
    const tipOf = (b) => localTip(b, work);
    const newer = (b, at) => newerCommitCount(b, at, M, work);
    const cA = classifyScratch([decl("scratch-ok", futureAt, tipOk), decl("ghost", futureAt, tipOk)], local, tipOf, newer);
    check("a declared branch at its declared tip is excluded (a)", cA.excluded.includes("scratch-ok") && !cA.excluded.includes("undeclared"));
    check("a declared name with no local branch is reported stale, not fatal (a-stale)", cA.stale.join() === "ghost");
    check("an undeclared branch is never excluded (b)", !classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, tipOf, newer).excluded.includes("undeclared"));
    const cT = classifyScratch([decl("scratch-ok", futureAt, "0".repeat(40))], local, tipOf, newer);
    check("a declared name whose local tip is NOT the declared tip is counted as work (tip)", cT.reopened.join() === "scratch-ok" && cT.excluded.length === 0);
    const cD = classifyScratch([decl("scratch-ok", pastAt, tipOk)], local, tipOf, newer);
    check("a declared branch at its tip with a commit newer than declaredAt is counted again (d)", cD.reopened.join() === "scratch-ok" && cD.excluded.length === 0);
    // (n-tag) a TAG named like the declared branch, on an older commit: the bare name would count the tag's history and read zero newer commits
    sh("checkout", "-q", "-b", "scratch-tag", "main"); cm("st-tag.txt", "x\n"); sh("tag", "scratch-tag", "main");
    check("a tag named like a declared scratch branch does not hide the branch's own commit newer than declaredAt (n-tag)",
      raw("rev-list", "--count", `${M}..scratch-tag`) === "0" && newerCommitCount("scratch-tag", pastAt, M, work) === 1);
    sh("tag", "-d", "scratch-tag");
    // (n-replace) a replace graft on the branch tip would shrink the count to one: the log runs with replace objects off, like gitIn
    sh("checkout", "-q", "-b", "rp", "main"); cm("rp1.txt", "1\n"); const rp2 = cm("rp2.txt", "2\n");
    sh("replace", "--graft", rp2, g("rev-parse", "main"));
    const rpCount = newerCommitCount("rp", pastAt, M, work), rpRaw = raw("log", "--format=%ct", `${M}..refs/heads/rp`).split("\n").filter(Boolean).length;
    sh("replace", "-d", rp2);
    check("newerCommitCount reads the real graph: a replace graft on the branch tip does not shrink the count (n-replace)", rpRaw === 1 && rpCount === 2);
    check("a git failure reads as new work, never as clean (d-fail)", newerCommitCount("no-such-branch", futureAt, M, work) === null && classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, tipOf, () => null).excluded.length === 0);
    check("an unresolvable local tip never equals a declared tip", localTip("no-such-branch", work) === null && classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, () => null, () => 0).excluded.length === 0);
    // validation (c): every shape the file must refuse
    const good = [decl("scratch-ok", futureAt, tipOk)];
    const bad = (mut) => validateScratchDeclaration(JSON.stringify([{ ...good[0], ...mut }])).ok === false;
    check("a complete declaration validates", validateScratchDeclaration(JSON.stringify(good)).ok === true);
    check("an entry missing reason is INVALID (c)", bad({ reason: "" }));
    check("an entry missing origin is INVALID (c2)", bad({ origin: undefined }));
    check("an entry missing tip is INVALID (c-tip)", bad({ tip: undefined }));
    check("a tip that is not a full 40-char sha is INVALID (c-tip2)", bad({ tip: "abc123" }));
    check("a wildcard name is refused (c3)", bad({ name: "attack-*" }));
    check("a regex-shaped name is refused (c4)", bad({ name: "^scratch.*$" }));
    check("a duplicate name is INVALID (c-dup)", validateScratchDeclaration(JSON.stringify([good[0], good[0]])).ok === false);
    check("a non-JSON declaration is INVALID (c5)", validateScratchDeclaration("{nope").ok === false);
    // the file is read from MAINLINE: present, absent, invalid, and a working-tree plant that must be ignored
    mkMainline("decl-ok", JSON.stringify(good));
    mkMainline("decl-bad", JSON.stringify([{ ...good[0], reason: "" }]));
    mkMainline("decl-none", null);
    execFileSync("mkdir", ["-p", join(work, "docs/agent")]); put(SF, JSON.stringify(good)); // untracked plant on decl-none's working tree
    const eOk = evaluateScratch("decl-ok", work, local), eBad = evaluateScratch("decl-bad", work, local), eNone = evaluateScratch("decl-none", work, local);
    check("a declaration on mainline excludes the declared branch end to end (m-ok)", eOk.ok && eOk.excluded.join() === "scratch-ok");
    check("an invalid declaration on mainline is INVALID and excludes nothing (m-bad)", eBad.exists && !eBad.ok && eBad.excluded.length === 0);
    check("a declaration present only in the WORKING TREE is ignored (m-wt)", !eNone.exists && eNone.excluded.length === 0);
    check("a mainline ref git cannot resolve declares nothing (m-absent)", evaluateScratch("no-such-ref", work, local).exists === false);
    // wiring: the exclusion must actually remove the branch from the unpushed list
    check("an excluded branch drops out of the unpushed list; an undeclared one stays (w)", unpushedCandidates(["scratch-ok", "undeclared"], [], [], ["scratch-ok"]).join() === "undeclared");
    check("with nothing excluded both stay on the unpushed list (w2)", unpushedCandidates(["scratch-ok", "undeclared"], [], [], []).join() === "scratch-ok,undeclared");
  } catch (e) {
    check(`self-test harness ran without throwing (${e && e.message ? e.message.split("\n")[0] : e})`, false);
  } finally {
    for (const [k, v] of Object.entries(callerGitEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `self-test FAILED (${checks.length - failed}/${checks.length})` : `self-test passed (${checks.length}/${checks.length})`);
  return failed ? 1 : 0;
}
