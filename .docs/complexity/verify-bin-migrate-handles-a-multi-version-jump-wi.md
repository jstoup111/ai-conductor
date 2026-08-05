# Complexity: Safe multi-version harness migration

Tier: M

The change introduces one small piece of durable per-consumer state (an applied-block ledger),
reworks a single shell runner and its embedded parser, corrects already-queued changelog block
content, and adds first-ever test coverage for that runner. No model, credential, external
service, or multi-actor state machine is involved, and the story count is moderate. This matches
the `size: M` disposition recorded on the originating issue. The plan stem must remain
`verify-bin-migrate-handles-a-multi-version-jump-wi`.
