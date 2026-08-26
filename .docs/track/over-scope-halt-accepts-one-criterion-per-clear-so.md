# Track: over-scope-halt-accepts-one-criterion-per-clear-so

Track: technical

Scope boundary: Replace the per-line `OVER_SCOPE_ACCEPT:` marker with a single fenced
`OVER_SCOPE_DECISIONS` JSON array carrying every blocking (`outside-visible`, unaccepted,
un-refused) finding with a per-entry `decision: accept|refuse` field. Refusals are durable
(recorded alongside accepted widenings; a later acceptance overrides a refusal, and a refusal
stops mattering once the audit no longer flags the criterion). Candidate selection is fixed to
blocking findings only. No legacy single-line marker path — pre-v1, breaking format change
accepted by the operator. Source: jstoup111/ai-conductor#1846.

Engine/daemon halt mechanics only; no product surface — acceptance criteria live in stories.
