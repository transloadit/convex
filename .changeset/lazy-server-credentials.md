---
"@transloadit/convex": patch
---

Resolve API credentials only when an operation needs them. Constructing a client and reading local
metadata no longer require API credentials; signing and refresh still require both the key and
secret, while webhook verification requires only the secret.

Recommend app-authorized functions and internal webhook ingestion in the quickstart. Deprecate
`makeTransloaditAPI()` and `client.api()` without changing their public exports; existing integrations
must still add their own authorization. Link the runnable wedding app instead of duplicating its
upload flow in a partial example.
