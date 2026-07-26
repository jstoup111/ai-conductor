# Conflict Check: Codex readiness park #970

**Date:** 2026-07-26  
**Status:** Clean — zero blocking conflicts, zero accepted degrading conflicts

## Inventory and method

The check loaded the complete current inventory: 200 story files, 38 active spec files, and 120
prior conflict reports. Candidate interactions were selected by behavior and shared state, not by
filename alone: authentication readiness, provider/source selection, parked recovery, retry and
fallback budgets, probe timing, daemon event/log durability, audit classification, feature-tagged
logging, grouped dispatch, and operator park markers.

Every candidate interaction was checked for contradiction, behavioral overlap, state conflict,
resource contention, and sequencing conflict.

## Material interactions checked

### #905 readiness states vs #970 mixed-health classification

**Files:** `.docs/stories/codex-auth-sandbox-permission-readiness-905.md`,
`.docs/specs/2026-07-25-codex-auth-sandbox-permission-readiness-905.md`, and
`.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible (verified, 99%). #905 classifies a result as `unverifiable` when an external
failure prevents an authentication decision. #970's changed case contains supported, explicit
`auth.credentials.status: ok` evidence, so the unrelated failing check does not prevent that
decision. Missing, rejected, malformed, unsupported, and absent auth evidence remain fail-closed.
The approved #970 ADR explicitly supersedes the older readiness-classification ADR.

### #927 provider routing vs #970 recovery

**Files:** `.docs/stories/per-step-provider-routing-927.md` and
`.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible (verified, 99%). Both require the common bounded authentication park while
preserving the selected provider and authentication source, with no provider fallback and no
retry/model-escalation budget consumption. #970 changes only Codex cached-login evidence and probe
cadence inside that boundary.

### Global rate-limit recovery vs credential recovery backoff

**Files:** `.docs/stories/daemon-api-rate-limit-episode-cascades-into-mass-h.md`,
`.docs/stories/rate-limit-wait-signal.md`, and `.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible (verified, 98%). Rate-limit coordination owns account-wide throttling after
a rate-limit failure. #970 owns per-feature, auth-source-specific readiness probes during a cached
credential park. They use distinct failure classifications, state owners, event variants, and
deadlines; neither assumes exclusive ownership of a shared retry counter or timer.

### Operator park markers vs authentication park lifecycle

**Files:** `.docs/stories/park-all-dispatch-paths.md`,
`.docs/stories/operator-park-a-human-placed-halt-must-survive-the.md`, and
`.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible (verified, 99%). Operator park is a persistent dispatch-control marker.
Authentication park is a bounded in-feature recovery state and does not create, clear, or reinterpret
the operator marker. There is no shared-file contention or circular ordering.

### Progress durability vs audit allowlist

**Files:** `.docs/stories/audit-trail-write-completeness-for-retro-under-fre.md`,
`.docs/stories/wave-c-telemetry-event-log.md`,
`.docs/stories/daemon-log-feature-tags-254.md`, and
`.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible with an explicit contract boundary (verified, 98%). The audit trail uses a
closed allowlist for retro friction records and deliberately classifies UI/transport-only events,
including the existing `credentials_park`, as not audited by design. #970 requires the new typed
variant to pass through durable daemon/event logging and requires every exhaustive consumer to
persist/render it **or deliberately classify it**; it does not require silently widening the audit
record schema. Therefore implementation must add an explicit audit-completeness classification for
`credentials_park_progress`, while durable operator history remains available through the existing
daemon/event log path. Feature-scoped rendering also preserves #254's log-tag contract.

### Existing Claude/API-key/grouped recovery vs cached-login cadence

**Files:** `.docs/stories/build-auth-token-check-and-classify.md`,
`.docs/stories/sandbox-auth-expiry-park.md`, `.docs/stories/per-step-provider-routing-927.md`, and
`.docs/stories/codex-readiness-park-970.md`

**Verdict:** Compatible (verified, 99%). #970 explicitly leaves Claude recovery and Codex API-key
restart behavior unchanged. Serial, grouped, and auxiliary Codex dispatches share the new
cached-login classifier/cadence without introducing a second park or fallback path.

## Five-type re-check

| Conflict type | Result | Evidence summary |
|---|---|---|
| Contradiction | None | The only classification change is scoped to conclusive auth-specific evidence and is captured by the superseding ADR. |
| Behavioral overlap | Compatible | Shared auth park and event consumers have one owner and additive, bounded behavior. |
| State conflict | None | Provider, source, readiness, operator-park, and rate-limit states remain distinct. |
| Resource contention | None | No story assigns incompatible meanings to a marker, budget, timer, or persisted record. |
| Sequencing conflict | None | Immediate check, deadline-capped sleeps, and dispatch/recovery ordering are acyclic. |

## Result

Conflict check passed. No story or upstream artifact requires resolution, no compromise was
accepted, and no review-required marker is warranted.
