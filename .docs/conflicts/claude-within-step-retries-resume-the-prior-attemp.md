# Conflict Check: Cold-Start Within-Step Retries (#1071)

**Date:** 2026-07-27
**New stories:** `.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`
(ST-1071-1 … ST-1071-6)
**Scanned against:** all `.docs/stories/`, `.docs/decisions/` ADRs touching sessions
(`adr-2026-07-24-provider-aware-step-execution`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-10-concurrent-group-core`), `HARNESS.md`, the retry-as-escalation and
self-host guardrail specs, and open issues #903 / #999
**Result:** PASSED — 3 conflicts found and resolved in stories, 0 blocking remain

---

## Conflict 1: Direct contradiction with the accepted within-step resume story

**Artifacts involved:** ST-1071-1/2/3 (new) vs `.docs/stories/fresh-session-per-step.md`
story "Within-step retries resume the same session (not fresh)" (`:100-126`)
**Type:** contradiction — the same observable behavior is asserted with opposite verdicts
**Severity:** blocking if unresolved

**Description:** The accepted #325 story states at `:102-107` that "A step's own internal
retry attempts continue that step's session — a retry is a continuation of the same task,
not a new step, so it must resume rather than reset", and at `:119-120` requires that "test
FAILS if that attempt started a fresh session (new id / create)". ST-1071-1 requires exactly
that fresh id and create. Left as-is, the two stories license opposite implementations and a
future reader cannot tell which is current.

**Resolution applied (story-level):** ST-1071-6 makes the amendment a required deliverable
rather than an implicit consequence. The #325 story is amended in place with a supersession
note pointing at `adr-2026-07-27-cold-start-within-step-retries`; its acceptance criteria are
rewritten to assert cold start, not deleted, so the *step-boundary* guarantee it also carries
(which is unchanged and still correct) survives. The new stories carry an explicit
supersession note in their preamble. The guard-against-regression intent of `:119-120`
inverts rather than disappears.

**Why not a new story file only:** two story files asserting opposite criteria both marked
`Status: Accepted` is precisely the drift this repo's coherence gate exists to catch.

---

## Conflict 2: ST-927-7 asserts step-and-provider resume as a positive requirement

**Artifacts involved:** ST-1071-1 (new) vs
`.docs/stories/per-step-provider-routing-927.md` ST-927-7 (`:291-341`), and
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` §2 (`:47-62`)
**Type:** contradiction — ADR-ratified requirement
**Severity:** blocking if unresolved

**Description:** ST-927-7 at `:309-311` requires "Given an ordinary failure retries the same
step on a provider, when the retry dispatches, then it resumes that step-and-provider session
rather than minting a new session", and its Done-When at `:337-341` requires tests proving
it. ADR §2 ratifies the same. ST-1071-1 reverses both.

**Resolution applied (ADR + story level):** `adr-2026-07-27-cold-start-within-step-retries`
is authored as an explicit **supersession of §2 only** — §1 (identity keyed by step and
provider), §3 (fallback starts provider-native context), and §5 (persistence must identify
the owning step and provider) are retained unchanged and are consistent with cold start.
ST-1071-6 requires the superseded §2 to carry a forward pointer, and ST-927-7's resume
criterion to be rewritten. The remainder of ST-927-7 (fresh on step boundary, fresh on
fallback first attempt, never resume a prior step's marker) is **strengthened**, not
weakened, by this change.

**Verified non-conflict within the same ADR:** §1's "session identity is scoped by step and
provider" is not violated by per-invocation minting — a per-invocation id is strictly finer
than per-step-and-provider, so every isolation guarantee §1 makes still holds.

---

## Conflict 3: Scope overlap with open issue #903

**Artifacts involved:** ST-1071-1 (provider-neutral) vs issue #903 "Codex behavior is
unvalidated against fresh-session-per-step flow"
**Type:** resource contention — two work items owning the same seam
**Severity:** degrading (not blocking; #903 has landed nothing)

**Description:** #903's stated remit includes "Retries for the same step preserve only the
intended step-local context" and hypothesises "A provider capability flag may still be useful
for resume support and retry-session behavior". ST-1071-1 decides that question
provider-neutrally and rejects the capability flag. If both proceed independently they will
contend over `provider-session.ts` and `codex-provider.ts` and reach incompatible designs.

**Resolution applied:** Verified that #903 has landed **nothing** — repo-wide search returns
zero hits for `supportsSessionResume`, `coldStart`, or `#903`, so there is no code to
conflict with, only intent. The ADR records the rejection of the capability flag with its
reasoning, and both the ADR and the architecture review recommend closing #903 as resolved by
this change. The merge of this spec PR is the operator's decision point; the architecture
review states the reversal path (Claude-only scope, capability flag returns, #903 sequenced
first) if the operator declines.

**Residual risk:** if #903 is dispatched to the daemon before this spec merges, the two will
collide. Flagged for the operator rather than resolved in-spec, since issue sequencing is not
a spec-level lever.

---

## Verified-clean pairs (reasoned, not assumed)

- **Self-host isolation** (`.docs/decisions/architecture-review-harness-self-host-guardrails.md`,
  `provider-execution.ts:546`, `provider-execution.test.ts:116`) — `forceFreshSession` already
  requires `resume: false` for self-host dispatch. Cold start is a **superset** of that
  requirement, so the self-host guarantee is preserved by construction. Its test must keep
  passing unchanged; the parameter becoming redundant is a cleanup question, not a conflict.
- **Concurrent group core** (`adr-2026-07-10-concurrent-group-core.md`) — the ADR requires a
  branch never to read or mutate the main conductor session. Per-invocation minting makes
  branches *more* isolated, never less. ST-1071-2 keeps the cross-branch isolation assertion
  as an explicit negative-path criterion so the change cannot weaken it silently.
- **Retry-as-escalation (#188)** (`.docs/stories/retry-as-escalation.md`,
  `.docs/conflicts/retry-as-escalation.md`) — escalation passes model and effort explicitly
  per rung and prefixes `RETRY: «reason»` to the full step system prompt
  (`step-runners.ts:1901-1903`). No escalation behavior is carried in the session, so cold
  start does not disturb the ladder. `retry-as-escalation.acceptance.test.ts` changes only in
  its `resume` expectations; the ordered model/effort ladder assertions are untouched. The S10
  non-consuming stale-session case (`:413-444`) is preserved by ST-1071-5.
- **Fresh-session-per-step's *step boundary* guarantee** — unchanged and reinforced. Only the
  within-step carve-out inverts.
- **`.pipeline` durability specs** (`pipeline-durability.test.ts`,
  `pipeline-read-sites-durability.test.ts`) — these assert the `session-created` marker is
  persisted, not that it implies resume. ST-1071-3 changes the marker's *consequence*, not its
  persistence, so the durability contract is intact.
- **OTel run-id contract** (`otel/resource.ts`, #FR-6) — verified that
  `.pipeline/conduct-session-id` is written only from the step runner's `this.sessionId`, never
  by `ProviderSessionScope`. No contention; ST-1071-5 pins this as a testable invariant so a
  future implementation cannot introduce one.
- **#999 daemon-log analysis** — supplies the retry-volume evidence only; it asserts no
  session behavior and cannot conflict.
- **Release/migration gates** — no `bin/conduct-ts` flag, hook wiring, skill symlink target, or
  `settings.json` schema changes, so no migration block is required. ST-1071-6 covers the
  waiver path if the gate's path classifier flags a surface anyway.

## Coverage note

No story in this set contends with another for the same seam: ST-1071-1, -2, and -3 each own a
**distinct** resume authority (provider scope, branch executor, legacy scalar) and are
independently testable; ST-1071-4 owns the interactive path; ST-1071-5 owns the recovery and
telemetry invariants that the other four must not break; ST-1071-6 owns documentation. The
only ordering constraint is that ST-1071-5's guard tests should exist before the resume
machinery is simplified, so that a cleanup pass cannot remove a live recovery path unnoticed.
