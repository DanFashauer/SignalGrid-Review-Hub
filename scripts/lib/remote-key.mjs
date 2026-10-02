// remote-key.mjs — the identity a remote URL implies. Pure: no disk, no clock, no subprocess.
//
// Its own module, not a function inside check-cited-paths.mjs, because that file runs
// `git ls-files` when it LOADS (via lib/skill-plane.mjs). scan-estate-citations' self-test
// must run with git off PATH, yet it has to push RAW origin strings through THIS parser:
// the defect it guards (a relative-path origin read as a hosted owner/name) lives here, and
// a test that hands `locate` a pre-parsed shape never touches it.

/**
 * Pure: the identity a remote URL implies, as `{ key, hasOwner }` — plus, for a hosted
 * remote, `host` (lower-case, userinfo and port dropped) and `depth` (path segments after
 * the host; `owner/repo` is 2). Handles the https form (`https://host/owner/repo`), the
 * scp-style ssh form (`git@host:owner/repo`), the `ssh://` form, an optional `.git` suffix
 * and a trailing slash.
 *
 * HOSTED means exactly two shapes: `scheme://host/…` (other than `file:`; the authority
 * is non-empty and holds none of `#`, `?`, `\` or whitespace, which git does not read as
 * userinfo) and `user@host:path` (no `:` in `user`: git splits an scp form at the FIRST colon).
 * Nothing else carries an identity, however much it looks like one. What git itself resolves
 * as a directory — a bare `owner/repo`, `mirrors/owner/repo`, `owner/repo.git`, `file://…`,
 * an absolute or `.`/`~` path: no `:` before the first `/` — is a LOCAL PATH and degrades to
 * the bare name. Everything else (`host:path` with no user, `helper::url`, a spoofed host) is
 * a transport this parser cannot vouch for: it keeps its RAW string as the key, so no name
 * alias can ever match it. (This used to call a path local only when it began with `/`, `.`
 * or `~`, so `git remote set-url origin owner/repo` read as a hosted `owner/repo`.)
 *
 * `hasOwner` is the load-bearing half. A hosted remote yields `owner/repo` and
 * `hasOwner: true` — a full identity. A LOCAL PATH origin (`/home/user/Repo`,
 * `file:///srv/git/Repo`, `../Repo`, `owner/Repo`) has no owner in any meaningful sense:
 * every segment before the last is a filesystem accident of that machine, so the key
 * degrades to the name alone and `hasOwner: false` tells the caller to LABEL it as a
 * basename fallback rather than claim an identity it did not read.
 *
 * `hasOwner` does NOT mean "github.com, exactly owner/repo": the cloud sandbox's proxy
 * origin (`http://…@127.0.0.1:port/git/owner/repo`) is hosted with depth 3 and must keep
 * its key. A caller that needs the stricter claim (the estate scan) checks `host` and
 * `depth` itself.
 *
 * Returns undefined for anything it cannot read, so the caller falls back rather than
 * inventing a key.
 */
export function repoKeyFromRemote(url) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (!trimmed) return undefined;

  // `\s` is excluded from the scp prefix so a stray first line cannot hide in front of it.
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(trimmed)?.[1]?.toLowerCase();
  // …and `:` is excluded from the user part because git splits the scp form at the FIRST
  // colon: `evil.invalid:x@<host>:o/r` is host `evil.invalid`, whatever <host> says.
  const scp = /^[^/:\s]+@([^/:\s]+):(\S+)$/.exec(trimmed);
  // `#`, `?` and `\` end the authority in a URL, so `https://evil.invalid#@github.com/o/r` is
  // host `evil.invalid` — yet the userinfo strip below would read past them to github.com.
  const authority = trimmed.split("/")[2] ?? "";
  const hosted = scp || (scheme && scheme !== "file" && /^[^#?\\\s]+$/.test(authority));

  const segs = (scp ? scp[2] : trimmed.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "")).split("/").filter(Boolean);
  const name = segs[segs.length - 1];
  if (!name) return undefined;
  if (!hosted) {
    // Git's own rule: a URL with no `:` before the first `/` (or `file://`) is a directory.
    const gitLocal = scheme === "file" || !/^[^/]*:/.test(trimmed);
    return { key: gitLocal ? name : trimmed, hasOwner: false };
  }

  // For a scheme URL the authority is segs[0]; drop it, then the segment immediately
  // before the name is the owner.
  const path = scp ? segs : segs.slice(1);
  const owner = path.length >= 2 ? path[path.length - 2] : undefined;
  if (!owner) return { key: name, hasOwner: false };

  const host = (scp ? scp[1] : segs[0]).replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
  return { key: `${owner}/${name}`, hasOwner: true, host, depth: path.length };
}
