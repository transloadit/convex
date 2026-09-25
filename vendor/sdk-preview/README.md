# Unpublished SDK preview

Prerelease packages built from the `viewer-react` SDK branch at a recorded commit (see
`manifest.json` for the commit, source hash and tarball hashes), vendored so CI can verify the
Convex integration before the Viewer alpha and the `@transloadit/zod` Storage extractor are
published. Replace these `file:` dependencies with the published versions before merging; the
package cannot be released while it depends on them.
