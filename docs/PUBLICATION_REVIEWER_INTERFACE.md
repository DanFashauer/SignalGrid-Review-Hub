# Publication reviewer interface

The publisher separates content validation from reviewer identity and file
ownership and access. These interfaces let a reviewer helper test its content
against the same validator the publisher uses. They do not issue a clearance or
enable publication.

## Two clearance routes, and which statements apply to which

The publisher reads a privacy clearance through one of two routes. Everything on
this page that speaks of a "reviewer account", an "independent" reviewer, or
directory and file ownership by another user describes the first route only.

1. **Independent-user route (v2).** A clearance written by a separate macOS user,
   read with the ownership, mode and ACL checks described below. Existing v2
   receipts remain supported. This is the route the reader uses when no
   contained-controller selection exists.
2. **Contained-controller route (`contained_controller_v1`).** Used only when an
   explicit, current controller selection exists under the owner's private
   brain state. It needs no second account and implies no account setup. Its
   trust boundary is different, and is stated here so it is not mistaken for
   the first:
   - It trusts the existing owner account and the controller running under it.
     It restricts the worker that produced the build; it does not claim
     separation between operating-system users. Arbitrary unsandboxed processes
     running as the owner remain trusted.
   - A receipt is accepted only when it is bound to the exact job, the current
     publisher bytes, the selected runtime sources, the prepared artifact, the
     recorded review admissions and their accounting, and the selection that
     was current when it was written.
   - The selection is a separate, qualified step. Its presence does not turn
     publication on: the tick's own activation and file-ownership anchor are
     still required.
   - The shared content validator and the reviewer helper described below are
     not a clearance for this route. A content-only pass grants nothing here
     either.

## Shared content validator

Import `validatePrivacyClearanceContent` from
`scripts/mac/brain-proposal-pr.mjs` and call:

```js
validatePrivacyClearanceContent(clearance, {
  source_review: sourceReviewBytes,
  artifact_review: artifactReviewBytes,
}, expectedRequest, nowMilliseconds);
```

Both evidence values are the exact UTF-8 JSON `Buffer` objects whose SHA-256
hashes appear in the clearance's evidence references. Each is bounded to 1 MiB.
`expectedRequest` is the actual prepared privacy request. The clock is an
explicit, nonnegative integer in milliseconds since the Unix epoch. A valid
content check returns `true`; invalid content throws an error.

The validator checks the existing v2 clearance and v1 request formats, exact
request binding, the one-hour expiry limit, distinct source and artifact
evidence, byte hashes, review kinds, systems, decisions, review timestamps and
nonempty summaries. Request digests use SHA-256 over UTF-8 JSON with object keys
sorted recursively; array order is preserved. This is the publisher's existing
digest convention, not a new request format.

This function performs no file reads or writes. It does not authenticate a
reviewer, check filesystem ownership or access, establish that a review occurred,
or grant permission to publish. Synthetic evidence is suitable for a helper's tests;
it is not a real review or production clearance.

On the independent-user route, the production reader still checks the real
reviewer account, its separation from both publisher and worker, directory and
file ownership/modes, immutable private reads, Darwin ACLs and actual publisher
write access. It then invokes this shared validator and compares the request
with the actual job, publisher and prepared artifact. On the contained-controller
route the reader applies that route's own bindings, listed above, and uses the
same content validator. A successful content-only test cannot bypass either path.

## Exact prepared title and body

The existing prepare operation is `run({ job, publish: false })`, also used by
the ordinary CLI without `--publish`. After screening the complete proposed
publication, it returns the existing `privacyRequest` plus:

```js
publicationMetadata: {
  format: "signalgrid-publication-prepared-metadata/v1",
  request_sha256: "...",
  title: "...",
  body: "...",
}
```

The CLI emits the same object after
`SIGNALGRID_PUBLICATION_PREPARED_METADATA `. The title and body are the exact
screened strings, without added newlines. Their UTF-8 bytes must match the
request's `metadata/title.txt` and `metadata/body.md` hashes and byte lengths.
A helper can therefore review them without reconstructing the body template.
Neither this object nor the prepare result contains publication approval.

## Prepared object access

Preparation removes its disposable worktree. The proposed commit and tree
remain in the publisher's Git object store and may be unreachable. Before real
review, the setup must provide the existing qualified reviewer read access to
those exact objects and retain them for the review window. Do not prune pending
objects. Object access, retention and independent account provisioning require
separate setup evidence; neither a content test nor a prepared hash proves them.

These content interfaces create no accounts, ACL grants, real review receipts,
installation or activation. The separately activated preparation step below
uses them without issuing a clearance.

## Automatic private preparation

The preparation code is implemented; activation and operational qualification
remain pending. After setup, the tick can prepare a fresh completed build for
independent privacy review.
Preparation uses the ordinary publisher without `--publish`; it does not push,
open a PR, call a model or write reviewer evidence.

The read-only selection is:

```bash
node scripts/mac/brain-proposal-pr.mjs --list-prepare --not-before <timezone-bearing-cutover>
```

It lists uncancelled review builds created at or after the explicit cutover,
excluding rows whose update predates creation and jobs that already have a
current artifact-bound clearance. The ordinary prepare operation still checks
the actual job, source paths, patch, replay, hooks and credential scan. A listed
job has no publication permission.

### Activation and file ownership

Preparation is off unless the existing source-pinned publication activation
explicitly contains `privacy_preparation_enabled: true`.
Setup must also create and anchor these private directories before the tick:

- `<state>/preparations`: preparation attempts.
- `<publication-attempt-mirror>/preparations`: independent mirrored attempt records.

The existing file-ownership anchor records their canonical path, device and inode
under `preparations` and `preparation_mirror`.
The tick never creates or repairs these control roots, activation or the anchor.
Changing publisher, tick or dependency source requires explicit requalification
and activation with the new source identities.

Cleared jobs get their publication opportunity first. Preparation uses only the
remaining per-tick CLI budget and takes its own ordinary host reservation.
A busy host leaves the job unconsumed. Once a preparation is claimed, failures,
interruptions, unknown outcomes or missing ownership records require readback.
The tick does not retry the CLI or recreate an expired or lost request.

### Private review handoff

A normally completed prepare emits exactly one request marker and one
prepared-metadata marker. The tick verifies their formats, complete typed
request, publisher identity, request digest, metadata hashes, original output
and terminal receipts before writing:

```text
<state>/preparations/<job>/request.json
```

This read-only `signalgrid-brain-privacy-handoff/v1` file contains the original
request, exact screened title/body, request SHA-256 and references to the
original intent and raw stdout. Its `privacy_clearance` and
`public_egress_allowed` fields are both false. It contains no source or
artifact review decision.

A qualified reviewer can consume the referenced original stdout through the
reviewer helper's `--prepared` interface. The reviewer must independently
establish the source provenance and inspect the exact artifact before issuing
the separate source and artifact decisions. Keep the raw handoff local; it is
not permission to send private job context, vault material or unaccepted worker
text to a cloud reviewer. Reviewer identity, object access, native review
admission and actual decision production require their own setup and evidence.

A prepared request is not a clearance. Before push the publisher still requires a
clearance through one of the two routes above: on the independent-user route, a
real independent reviewer account and its immutable evidence; on the
contained-controller route, a current qualified selection and a receipt bound as
described above. On both it checks the current job/source/publisher binding and
the exact prepared artifact. Publication still leaves
all applicable validation, current CI, source reviews and protected landing
requirements in place.
