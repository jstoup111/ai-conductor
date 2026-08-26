# ADR: Engine-stamped run identity for SHIP-tail verdict artifacts

Status: APPROVED
Date: 2026-08-25
Issue: jstoup111/ai-conductor#1838

## Context

On 2026-08-23, `prd_audit` attempt 14 ran 7m26s, settled ✓, and wrote neither
`.pipeline/prd-audit.md` nor its `review-required-prd_audit` marker. The completion check's
per-attempt mtime floor (adr-2026-07-13-session-fresh-verdict-artifacts) would have scored
"no fresh verdict", but the routing/halt path — `classifyPrdAuditGaps` (`artifacts.ts:4203`)
— filters on **session-level** freshness only, so the prior lap's report drove
`prdAuditNonClean` → `named-route` → a needs-human halt quoting findings the tree had
already resolved. Recovery required comparing artifact mtimes against daemon-log attempt
timestamps and hand-deleting `.pipeline/` files.

The mtime floor is a convention each reader must independently remember; this incident is
the second freshness defect in that family (the first: `VERDICT_FRESHNESS_FS_TOLERANCE_MS`
absorbing filesystem-clock lag). `build_review` already solved the same problem with an
engine-stamped `lapId` (adr-2026-08-13-engine-managed-build-review-rubric-branches §2, as
amended by adr-2026-08-19-engine-stamped-rubric-judged-result-envelope).

## Decision

Scope: the SHIP-tail verdict gates `prd_audit`, `architecture_review_as_built`, and
`manual_test`. `build_review` (already lapId-stamped) and custom-step completion markers
(adr-2026-07-25-custom-step-completion-artifacts item 3) are explicitly out of scope.

**D1 — Engine-minted run identity.** The engine binds a run identity to each verdict-gate
dispatch: the existing provider-lifecycle `attempt.id` (already minted per dispatch,
`provider-lifecycle.ts`). No new identity scheme, no new config key.

**D2 — Engine-stamped, never provider-echoed.** The engine stamps the run identity into the
verdict artifact set at the dispatch/settle boundary, as a second stamp dimension on the
existing gate-code-validity sidecar contract (adr-2026-07-22-gate-evidence-code-validity-
on-redispatch D1, beside `codeStamp`). Skills write only content. Provider-supplied identity
fields are ignored, never validated — validating an echo is the defect
adr-2026-08-19-engine-stamped-rubric-judged-result-envelope removed, and it is not
reintroduced here.

**D3 — Post-dispatch write handshake.** Immediately after a verdict dispatch settles and
before the completion check, the engine verifies the gate's declared outputs exist and were
produced by THIS dispatch (write observed at/after dispatch start; the stamp then binds
identity durably). The handshake writes its observation on every terminal outcome, not only
success (precedent: adr-2026-08-05-build-settle-outcome-stamp D1/D4). It never throws;
reads degrade (adr-2026-07-11-pipeline-state-durability D1).

**D4 — All readers go through one identity check.** The completion predicates,
`classifyPrdAuditGaps`, and every halt/routing reader of these artifacts consult the same
identity helper (extending the shared gate-code-validity helper, which already gates the
stale-artifact sweep — #817 D4). No reader keeps a private freshness convention. The check
routes through `checkStepCompletion` — no peer satisfaction authority is added
(adr-2026-07-11-verdict-aware-resume-entry D5).

**D5 — Mismatch means "no verdict", typed, never routed-on-text.** A missing or
prior-identity artifact is scored `routeClass: 'absent'` → **rerun** within the existing
step-retry budget (adr-2026-07-13-retry-classify-rerun-vs-route D1); its findings are never
read as current. The staleness reason names the artifact, the expected run identity, and
the found identity/mtime. The discrimination is a typed facet, never a reason-text match
(adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D1). On budget exhaustion the
halt is `needs-human`, its reason carries the same artifact + both identities
(adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D3), and it rides the
existing halt seam so the committed halt record carries the detail
(adr-2026-08-23-committed-halt-record).

**D6 — Recovery is clear-and-rerun.** Re-dispatch after a halt-clear treats prior-identity
artifacts as absent input, never as verdicts; the operator deletes nothing by hand.

**D7 — Legacy fallback and kill-switch.** An artifact with no identity stamp falls back to
today's mtime behavior — the change never makes an unstamped verdict more trusted than
today (#817 D3 verbatim). The existing gate-code-validity kill-switch reverts identity
checking to pure mtime (#817 D6); no new flag.

**D8 — manual_test composes.** The append-only `## Attempt N` sections and the
HEAD-movement whitewash guard (adr-2026-07-06-manual-test-fail-routing items 3–4) are
untouched; run identity is additive beside them and never weakens the HEAD-movement
condition.

**D9 — Telemetry extends the spine.** The identity decision extends the existing
`verdict_freshness` StepEvent `floorSource` vocabulary (e.g. `run-identity`) and the
`retry_decision` signal vocabulary. No new event member, no parallel channel.

**D9 amendment (2026-08-26, operator James Stoup).** `retry_decision` carries no enabled
sink: `event-sinks.ts` has scored it `{ render: false, persist: false, audit: false }` for
every signal since before this ADR was written, and this feature did not change that file.
Extending its signal vocabulary therefore adds an *internal typed facet*, not a persisted
one, and the original clause's promise that the new signal would reach `.pipeline/events.jsonl`
was mistaken about the channel, not about the design. The persisted, operator-visible surface
of the identity decision is `verdict_freshness` (`{ render: true, persist: true, audit: true }`),
which the stale path populates with `floorSource: 'run-identity'` and
`outcome: 'stale_invalidated'`, alongside the existing `step_retry` event; between them the
spine already carries which artifact was rejected, why, and both run identities. This ADR
makes no claim on `retry_decision`'s sink policy — enabling it would change telemetry volume
for every retry decision in every step and is a separate decision about that channel.

## Supersessions and amendments

- **Amended 2026-08-26 by operator (James Stoup):** D9's `retry_decision` clause — see the
  amendment note under the decision. D1–D8 stand unchanged.

- **Supersedes in part:** adr-2026-07-13-session-fresh-verdict-artifacts — its non-goals
  "no session-id stamp inside the artifact" and the manual_test deferral. Its per-attempt
  mtime floor survives as the D7 fallback; its `verdict_freshness` event is extended, not
  duplicated.
- **Amends:** adr-2026-07-22-gate-evidence-code-validity-on-redispatch D5 (run identity
  supersedes the within-dispatch mtime floor where a stamp exists; D3/D4/D6 preserved) and
  D1 (second stamp field beside `codeStamp`).
- **Amends:** adr-2026-07-13-retry-classify-rerun-vs-route D2 — `inputsUnchanged` keys on
  run identity where stamps exist, mtime otherwise; the `absent`⇒rerun mapping is preserved
  and load-bearing.
- **Unchanged:** adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch eligibility —
  these gates remain non-tree-attesting; this ADR makes no tree-attestation claim.

## Options considered

- **Skill-stamped identity, engine-validated** (filer hypothesis (a) as literally read) —
  rejected: the provider-echo pattern adr-2026-08-19-engine-stamped-rubric-judged-result-
  envelope removed after it discarded clean judgements and terminal-halted a feature.
- **Thread the per-attempt mtime floor into all readers** — rejected: keeps clock-skew
  fragility and stays a per-reader convention; this incident is precisely a reader that
  forgot the floor.
- **Clear verdicts before each dispatch** — rejected by
  adr-2026-07-13-session-fresh-verdict-artifacts ("a per-attempt sweep would destroy the
  file needed for diffing and is racier than the mtime comparison"); still holds.
- **Input-content-hash attestation per judged gate** (adr-2026-07-20 rejected Option B) —
  still rejected: content identity is the *reuse* key family (#817, content-addressed
  proofs); the question here is "did THIS dispatch write", which run identity answers
  without persisting input snapshots.

## Claims and confidence

- Stale-read mechanism (`classifyPrdAuditGaps` session-only freshness): **verified** by
  code read (`artifacts.ts:4203`, `conductor.ts:8050/9304`), 95%.
- Why attempt 14 wrote nothing: **unverified**; D3's handshake makes every variant of it
  visible and bounded, so root-causing the specific skip is best-effort during BUILD, not
  load-bearing for this design.
- `attempt.id` uniqueness per dispatch: **verified** (minted per provider attempt,
  `provider-lifecycle.ts:388`), 90%.
