# Publication reviewer interface

The publisher separates content validation from reviewer identity and file
ownership and access. These interfaces let a reviewer helper test its content
against the same validator the publisher uses. They do not issue a clearance or
enable publication.

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

The production reader still checks the real reviewer account, its separation
from both publisher and worker, directory and file ownership/modes, immutable
private reads, Darwin ACLs and actual publisher write access. It then invokes
this shared validator and compares the request with the actual job, publisher
and prepared artifact. A successful content-only test cannot bypass that path.

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

This interface change creates no accounts, ACL grants, real review receipts,
installation or activation, and does not change the tick.
