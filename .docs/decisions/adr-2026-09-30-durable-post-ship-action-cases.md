# ADR: Durable post-ship action cases and explicit merge-closure provenance

**Date:** 2026-09-30
**Status:** APPROVED
**Deciders:** Operator, 2026-09-30 ("approve" to the architecture and four scoped amendments)
**Source:** jstoup111/ai-conductor#1810

The operator approved this architecture and the four scoped predecessor amendments in D12 on
2026-09-30. The approved PRD and logical diagrams remain the product baseline. This decision
authorizes acceptance-story and plan authoring; implementation follows the normal merged-spec lifecycle.

## Context

The approved product is an operator action inbox, optional intake, historical recovery, and
additional issues closed by implementation merge. Existing mechanisms cover parts of that workflow:

- `RemediationCaseStore` has a version-2 envelope for build-review cases, PRD widening history,
  and suppressions. Its leased `mutate` operation validates identity and atomically replaces state.
  Its location is currently feature-worktree-local. Verified at spec base `cb4b8b86a`.
- Build-review deferral performs a remote intake effect before effective PASS. The current reducer,
  settlement predicate, and clean-PASS reconciler all regard unfinished deferral as an obligation.
  Changing only the effect executor would leave the feature blocked. Verified in
  `build-review-adjudication.ts`, `build-review-adjudication-coordinator.ts`,
  `remediation-case-effects.ts`, and `Conductor.settleRemediationCasesOnCleanBuildReview`.
- SHIP preserves recorded audit findings, delivered as-built plan gaps, and already-remediated
  findings. They must not all become open work. Verified in `shipment-association.ts`,
  `as-built-verdict-store.ts`, and real `.docs/shipped/` examples.
- The dispatcher owns shared-root mutations; feature executors return terminal effects. Verified
  in `FeatureTerminalEffects`, `daemon.collectOne`, and `daemon-cli` terminal-effect composition.
- The intake marker carries source/owner/outcomes. The issue-ref helper links a single source issue
  from the daemon tail; the common FINISH coordinator already serves attended and daemon modes.
  Intake markers are not presently in `PROTECTED_ARTIFACT_DIRECTORIES`.

## Governing decisions and structural prerequisite

Existing decisions govern case persistence, review authority, effect recovery, publication, and the
event spine. Reuse them; the uncovered structural changes are (a) a post-ship case domain with
durability beyond an executor, (b) replacing remote deferral as a review settlement prerequisite,
and (c) carrying explicitly approved closure provenance through shared publication.

- `adr-2026-09-07-durable-prd-widening-decision-reconciliation` D1-D2: separate operator authority
  from autonomous relationships; shared versioned storage preserves other domains.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` and its adopted predecessor:
  existing review judgement, identity, settlement, effects, and infrastructure precedence.
- `adr-2026-08-27-daemon-dispatcher-executor-seam` D1: no shared-root access by the feature executor.
- `adr-2026-08-01-engine-owned-resumable-finish-publication` D1-D3: shared observe-before-act,
  verify-after-write publication, with no independent publication progress ledger.
- `adr-2026-09-11-github-operation-ownership` D1-D3/D6: guarded exact-target mutations; no permission
  inherited merely from a linked issue; no assignee changes.
- `adr-2026-07-22-canonical-tracker-client-seam`: existing issue adapter and PR hosting boundary.
- `adr-2026-07-26-event-sink-registry-exhaustiveness` and
  `adr-2026-08-08-pipeline-owned-closeout-timestamps`: one event schema, explicit sink declarations,
  and separate single-writer ledgers when process boundaries require them.

## Options Considered

### Option A: Retain actions in the shared case machinery with domain-specific authority (selected)

Reuse leases, validation, atomic transitions, feature identity, and established source links.
Executors capture source observations locally; a repository-scoped instance owns operator action
state after collection. Retained shipment evidence makes missed collection recoverable.

- **Pros:** honors approach A, survives cleanup, preserves source provenance, and avoids another
  reviewer, service, scheduler, or issue for every concern.
- **Cons:** adds a storage scope and domain to a critical store; source observations must not
  overwrite operator decisions; existing deferral settlement needs a coordinated migration.

### Option B: Make GitHub issues the only action store

- **Pros:** familiar action list and existing issue lifecycle.
- **Cons:** operator rejected automatic filing for every finding; tracker availability would govern
  local triage, and unfiled actions would still need local durable state.

### Option C: Edit checklists in shipped Markdown records

- **Pros:** naturally retained with the feature.
- **Cons:** every resolution becomes a Git workflow; concurrent operator decisions require merge
  handling; the same finding's live and historical representation can diverge. Shipped records are
  retained source evidence, not the mutable operator inbox.

## Decision

### D1 — Reuse shared case storage with explicit storage scope and authority

Extend `RemediationCaseStore` to a version-3 envelope. Preserve the v1/v2 fields and meanings;
add separate `postShipSources` and `postShipCases` collections. They are a new domain, not
`build_review` dispositions or PRD risk decisions. Existing domain selectors must continue to
exclude them; existing mutations preserve every other domain's fields.

Two explicit factory-selected scopes use the same validator, lease, and atomic `mutate` machinery:

1. **Feature scope:** the existing `.pipeline/remediation-cases.json` holds autonomous review state
   plus immutable post-ship source observations. It cannot contain operator action resolutions or
   operator publication requests.
2. **Repository action scope:**
   `<main-root>/.pipeline/review-actions/<canonical-plan-stem>/remediation-cases.json` holds the
   authoritative `postShipCases` and their source snapshots. Build-review and PRD-widening control
   collections are empty in this scope; no gate reads it to derive PASS, accepted risk, or BUILD.

Use `resolveMainRepoRootStrict` in the dispatcher/standalone composition root and the existing
canonical shipment identity. Reject a missing/ambiguous repository or feature identity, path
traversal, a foreign-feature file, or a symlink escaping the resolved action directory. No silent
cwd fallback and no arbitrary public store-path option. Different features use different leases.

This extends case machinery without moving live gate control into shared-root state. Source
snapshots are evidence; only the repository action scope owns action decisions. Downgrade writers
must refuse v3 rather than drop its fields. v1/v2 reads remain compatible and upgrade atomically on
an actual write, preserving cases, suppressions, effects, and PRD history.

### D2 — Typed source observations preserve review judgement rather than repeat it

Normalize only already-consumed, authoritative results:

- Build review: adjudicated deferrals, an explicitly upheld remainder of a refutation, operator
  accepted-risk findings, and recorded confidence-suppressed findings. Preserve the subtype and
  confidence evidence; it is not a new assertion that a suppressed claim is correct.
- Requirements audit: findings the shared router actually records as non-blocking, preserving
  criterion identity, PRD case identity where available, intent relation, and prior decisions.
- As-built review: delivered PLAN_GAP findings from the typed verdict; retained repaired findings
  retain their completed outcome and do not become open actions.

Pure rejection/refutation, completed repairs, and explicit prior dismissals are historical outcomes,
not open actions. A refuted claim with a separately recorded upheld remainder creates an action only
for that remainder. Never consume a raw blocking result as non-blocking merely because a file exists.
Serial and validation-group execution call the same normalization boundary after freshness and
route classification. No new grading prompt or review dispatch is introduced.

Each observation carries source identity, repository/feature identity, gate and outcome, bounded
summary, evidence references or retained excerpts, original risk/decision evidence when available,
and existing issue/effect references. Missing supporting material is represented explicitly.

### D3 — Exact replay identity is mechanical; semantic equivalence stays with its existing judge

Prefer existing engine case IDs and judged source-to-case relationships. Otherwise assign a source
key from the authoritative report identity and the record's subject. Persist that key on first
capture and carry it unchanged into the shipment snapshot. Identical source replay is inert.

Historical records without modern IDs use an explicitly legacy namespace: canonical feature,
source kind, and a canonical digest of the exact retained record. An identical record in retained
review evidence and the shipped record maps to the same key when all retained identity fields agree.
Conflicting or ambiguous representations are named recovery diagnostics, not guessed equivalence.

Do not use token overlap, fuzzy summaries, ordinals alone, or cross-feature matching. A changed
source without an authoritative existing relationship may remain a separate concern; the inbox does
not become another semantic adjudicator. Retain all source links on an existing case. Replaying an
older source never changes an acted-on/dismissed decision or replaces a later authoritative outcome.

### D4 — Operator resolution and publication are independent state machines

An action has exactly one resolution: `open`, `acted-on`, or `dismissed`. A resolution records the
machine-resolved operator, reason or follow-up reference, and an engine revision. It is neither an
accepted-risk waiver nor permission to repair the originating feature. No autonomous producer may
write these decisions. Existing repaired/refuted source outcomes are historical eligibility, not
fabricated operator dismissals.

Publication is independently `not-requested`, `reserved`, `published`, or `failed` (including an
explicit uncertain-outcome diagnostic). Filing does not automatically resolve the action. Preserve
existing issue links, including closed issues, without creating a replacement or inventing an
operator resolution. Unknown action IDs and stale conflicting revisions refuse mutation; replay of
the same requested transition is idempotent. Concurrent writers are serialized by the feature lease.

Expose a narrow provider-neutral command family through the existing CLI dispatch:

- `ai-conductor actions list [--feature <slug>] [--status open|acted-on|dismissed|all] [--json]`
- `ai-conductor actions resolve --feature <slug> --action <id> --as acted-on|dismissed --reason <text>`
- `ai-conductor actions file --feature <slug> --action <id> [--title <text> --body-file <path>]`
- `ai-conductor actions recover [--feature <slug>]`

Invalid invocations show a usage error, never fall through to a build launcher. Listing is read-only
and returns completeness diagnostics with results. Add bounded pagination (default 100, maximum 500
items per page) without discarding stored history. Local list/resolve require no tracker connection.
No provider-session or daemon-worker exemption is added for these operator-only mutations.

### D5 — Non-blocking deferral settles by retained local handoff, not remote issue creation

The existing adjudicator still decides `defer` and justifies the concern. Its proposed intake text
becomes a suggested follow-up, not an instruction to publish. Add a distinct engine effect kind
`post-ship` whose applied evidence references the durably captured source observation. Never reuse
`deferral:applied` to pretend an issue was created.

Persist the source and the applied local-handoff effect in the same feature-store mutation. Update
all effect validators, source-coverage reducers, settled-recurrence predicates, contexts, and
clean-PASS reconciliation to recognize that outcome. It consumes no BUILD allowance and waits on no
network call. An action case, consistency stop, decision-owner escalation, malformed review result,
or uncovered infrastructure failure retains its existing blocking authority.

For legacy `defer` or residual-refutation effects: preserve the original effect ID, suggested intake
content, and any issue URL. Convert a non-blocking unfiled/failed deferral to the local handoff
atomically; its prior marker remains a publication-recovery alias. An applied issue remains linked.
Only those semantic dispositions are eligible; an unfinished BUILD effect cannot be migrated away.

Loss/corruption of the review's required control evidence remains its existing integrity failure.
Failure to mirror a valid source into the repository inbox, or to publish optional intake, is an
action diagnostic and never a new review halt, remediation task, or kickback charge.

### D6 — Dispatcher collection owns retention beyond worktree lifetime

Executors capture source observations only inside their worktrees. They return serializable source
observations and identity in an additive `FeatureTerminalEffects` member. The dispatcher imports
them through the repository action scope after claim release and before existing terminal cleanup
or sweeps, using `onFeatureTerminalEffects`. Collection applies to done/halted/error/parked results
that contain valid observations; it does not label a halted feature shipped.

The attended host performs the same import from its outer execution-return boundary. A standalone
operator `actions recover` may import explicitly selected active or retained feature sources. No
executor resolves or writes shared-root action state, and no new background loop or poller is added.

The existing shipped-record generation path retains versioned source observations with the feature
before normal publication/cleanup. It stores source IDs, evidence and prior outcomes, not a mutable
copy of the operator's inbox decisions. Retry is idempotent. This is the durable fallback when the
dispatcher crashes before collection or cannot mirror the source. Normal reaping continues to rely
on its existing committed shipped-record authority; it is not extended to depend on an inbox write.

After restart, the next existing terminal collection or explicit recovery reuses retained evidence.
Source observations, action state, and events have distinct roles: none is a replacement authority
for the others. A user-visible partial capture reports exactly which evidence remains available.

### D7 — Optional publication reuses the existing guarded intake/effect boundary

Only `actions file` authorizes a new issue for the selected action. Reserve one stable publication
identity under the action lease before any remote effect. Reuse a known link; otherwise search the
existing effect marker, including preserved legacy aliases, before creating through `fileIntakeIssue`
and the canonical tracker seam. A failed lookup never authorizes create. Content follows existing
sanitization and complete Observed/Impact/Desired outcomes/Hypotheses authoring requirements.

An inherited complete intake proposal may supply the title/body. For other sources, render an
evidence-prefilled proposal for the operator to complete using `--title` and `--body-file`; do not
invent impact or desired outcomes absent from the retained context. Incomplete authoring returns
the required input and creates nothing. Reuse existing intake validation and sanitization rather
than introduce a second intake contract. Valid explicit filing then follows the same effect path.

Use a separate publication lease scoped to the action across lookup/create, so two callers cannot
both create. Do not hold the feature-state lease across network I/O: reserve, release, perform the
effect under the publication lease, then re-read and persist the result. A concurrent operator
resolution is preserved when the link is recorded. Crash after create resumes lookup with the same
marker; ownership refusal, unknown result, or transport failure records a recoverable condition
without a duplicate-create fallback. Existing target authorization and credentials remain in force.

### D8 — Historical recovery uses retained evidence, never a reviewer

Recover modern source snapshots first, then supported legacy structured shipped findings, explicit
recorded audit sections, retained typed as-built evidence, and existing case/disposition evidence.
Only read original gate artifacts where they still exist; a removed worktree is not a prerequisite
when committed shipment evidence suffices. Resolve the canonical feature from plan/shipment identity
and reject ambiguous association.

Preserve root action resolutions, risk acceptance, publication links, and completed source outcomes.
Do not infer a missing decision from absence or parse arbitrary prose as a fresh reviewer verdict.
Valid records are independently importable; a bad record produces a source-specific diagnostic and
does not authorize erasure of valid siblings. Repeated recovery creates no duplicate source or action.

Bounds are explicit engineering limits, not silent truncation: source text 8,000 bytes, 64 evidence
references per source, 512 source links per case, and 16 MiB per repository-action feature envelope.
These limits do not newly constrain or reject the existing live gate-control collections. A source
that cannot be represented remains retained evidence and yields a named partial-recovery result;
no action is claimed captured. Existing review-context bounds remain unchanged. Pagination bounds
presentation, not durable retention. No new LLM is called for historical equivalence or extraction.

### D9 — Occurrences extend the existing event spine

Add typed `review_action_captured`, `review_action_resolved`, `review_action_publication`,
`review_action_recovery`, and `issue_closure_linkage` variants with feature/action/source references
and closed result/reason values. Register every sink explicitly. Payloads contain bounded IDs and
diagnostics, not raw intake bodies, credentials, or whole source snapshots.

In-process occurrences use the owning emitter and `EventPersister`. A standalone action command has
no engine emitter and may overlap another command: it uses its own emitter/persister with a
single-writer ledger under `<main-root>/.pipeline/review-action-events/<invocation-id>.jsonl`.
Extend the existing timestamp-ordered repository timeline reader to merge these same-schema ledgers;
CLI diagnostics and daemon timeline rendering consume the same event variants. No new watcher is
needed. Exceptions A/B justify the writer location; exception C covers case/source state.

Successful transition events follow confirmed persistence. A telemetry failure cannot undo a
confirmed resolution: report the persisted outcome plus the telemetry diagnostic without replaying
the mutation. Event timestamps never decide action identity, operator precedence, or recovery.

### D10 — Additional closure targets are explicit spec provenance

Use repeatable top-level `Closes-Also: owner/repo#N` lines in the existing
`.docs/intake/<canonical-plan-stem>.md`. Preserve `Source-Ref`, `Owner`, and armored outcomes through
every marker rewrite. Parse declarations only outside fenced/armored inbound evidence; issue text
cannot become a declaration by containing the same words. Support additional targets even for a
spec without an originating source issue.

A shared parser returns absence, a validated set, or a named invalid declaration. Additional targets
use fully qualified GitHub references with positive issue numbers; reject unsupported backend/URL
forms explicitly rather than turning them into meaningless GitHub closing keywords. This adds no
Jira closure integration and leaves existing origin-reference compatibility unchanged. Canonicalize
and deduplicate origin plus extras, including equivalent repeated issue numbers. No remote lookup
or issue mutation is needed at spec land.

The committed, reviewed declaration is authority. At BUILD entry extend the existing protected seal
with a closure-declaration descriptor: source commit, canonical intake path, and the digest of the
parsed closure target set. Read the marker from that commit at publication and verify the digest.
Carry the descriptor unchanged across automatic rebase/rebaseline; a new baseline must not adopt
BUILD-authored extra targets. Existing seals without the descriptor derive it only from a verified,
readable original baseline; otherwise refuse added-target publication with a named recovery need.
A later worktree edit cannot add targets. Compare the active declaration to the authorized projection
and return a DECIDE-owned correction diagnostic on change. An intentional revision uses the
existing explicit operator reseal workflow, extended for this specific projection.

Do not protect the whole marker as immutable: legitimate owner stamping and retained intake outcomes
are outside the closure projection. This is an additive commitment in the existing seal, not a new
source-of-truth snapshot file. Empty declarations preserve legacy origin-only behavior.

New spec handoff uses `Refs` for declared targets and no closing instruction. The implementation
uses the authoritative declaration, not a provider-authored PR body or mutable backlog field.
Transporting the set in the work order is allowed, but publication revalidates it against the
baseline; the work-order manifest does not become a second artifact authority.

### D11 — Shared FINISH publication owns complete closure linkage

Extend the existing issue-ref boundary to process the complete target set in one body update with
typed `complete | incomplete | refused` results; do not treat its present ambiguous boolean as
proof of success. Resolve and authorize the exact implementation PR before a write. Preserve
unrelated body bytes and existing project-owned regions; do not replace unreadable/malformed remote
content with an empty body. Fully qualified targets are distinct across repositories; an unqualified
`#N` only covers the PR's repository. No duplicate engine closing line is added for an already
present equivalent closing reference.

The common FINISH coordinator applies and verifies the target set after prose is authored and
before ready/final completion. Draft creation and later body refreshes use the same pure projection.
The daemon-tail single-source caller becomes a compatibility call to this shared behavior, not a
second closure authority. A hand-authored spec with no origin but valid extras must not hit the
old no-source skip. Retry re-observes the body and fixes only missing linkage. No broad BUILD repair
is created for a publication failure; the existing FINISH recovery path reports incomplete coverage.

GitHub applies closing keywords only for a pull request targeting its default branch, and supports
fully qualified references to several issues. Verify the target base before claiming merge-closure
coverage; a non-default target reports the unsupported closure outcome instead of claiming success.
Evidence: [GitHub's linking documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue), read 2026-09-30.

This adds PR-body linkage, not direct issue-close calls, and preserves issue assignees. The explicit
reviewed declarations authorize the closure intent; the PR mutation still passes the existing
ownership guard. Spec PRs never gain closing directives for these targets.

The operator resolved the repository-wide observed-close conflict on 2026-09-30 in favor of
this merge-time contract. For targets handled by this workflow, an older watched declaration
cannot substitute `Refs` or require observation before closure. No observation-marker land
prerequisite or watch implementation is added. Independently enrolled watches outside this
publication operation are not modified.

### D12 — Reconcile older decisions in DECIDE after operator approval

Operator approval authorizes these scoped additive amendments, preserving original text:

- In `adr-2026-08-21-review-bound-by-plan-done-when-criteria`, amend D4-D5 to replace the unimplemented
  beyond-store/automatic-filing prescription with this shared post-ship case handoff. Keep D1 and
  the rubric's judgement authority; preserve the later security amendment.
- In `adr-2026-08-29-build-review-remediate-case-adjudication`, amend D4-D6/D8 to adopt local
  non-blocking handoff and optional remote publication. Preserve action effects, identity,
  operator-risk authority, and mixed-lap precedence under the successor.
- In `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, amend D3/D5's required
  effect and settled predicates so an applied local handoff settles deferral, while a genuine
  unfinished BUILD effect or infrastructure/decision stop remains blocking. Cover residual
  refutation and the imported predecessor contract explicitly.
- In `adr-2026-09-07-durable-prd-widening-decision-reconciliation`, amend D2 for the version-3
  additive domain/storage scopes. Its PRD relationship and operator decision authority remain intact.

The operator additionally approved the conflict-check resolution on 2026-09-30: amend the
July 10 observed-close ADR's overlapping closure policy and the July 3 / July 11 FINISH ADRs'
origin-only/warn-only linkage clauses. Correct the legacy issue-link PRD beside FR-5/FR-7 and
replace the affected observed-close, issue-link, halt-rehabilitation, and settled-recurrence
story assertions in place. These corrections preserve the approved full scope; they introduce
no observation service and do not weaken genuine review blockers.

These amendments are made beside their governing clauses on the spec branch after approval and
before land. They are not tasks for BUILD and are not separate amendment artifacts. The dispatcher
and FINISH ADRs are reused without supersession because their existing ownership is preserved.

## Consequences

### Positive

- Non-blocking review concerns have durable operator actions without mandatory issue creation or
  a second reviewer. Existing source, risk, and case decisions remain inspectable.
- Worktree cleanup no longer determines whether an operator can act on a shipped finding.
- Publication and resolution are independently recoverable. Source replay cannot erase a decision.
- Additional closure targets are reviewed with the spec and mechanically preserved at publication.

### Negative

- A shared case-envelope migration and several settled-effect consumers must change together.
- Canonical inbox visibility may lag a running feature until terminal collection; its source
  evidence is already retained locally and explicit recovery can import it. No polling is added.
- Exact legacy evidence can be recovered, but lost evidence and uncertain semantic equivalence
  cannot be reconstructed automatically. The operator sees incomplete recovery rather than a guess.
- Repository-local action decisions survive worktree cleanup, not destruction of the entire clone.
  Shipped source evidence is committed; cross-machine synchronization of later operator decisions is
  not introduced by this feature.

## Follow-up Actions

- Architecture and four scoped amendments approved and applied during DECIDE on 2026-09-30;
  unrelated historical decisions remain intact.
- Author accepted stories and a bounded plan with explicit owners for case migration, source
  capture/retention, operator operations, optional publication, and additional closure linkage.
- Cover process boundaries with controlled tracker/Git adapters, including restart after remote
  creation, concurrent requests, bad historical records, and executor zero-root-write behavior.
- Update user-facing workflow and recovery documentation in the implementation; do not add a new
  service, skill, broad refactor, or directory-removal feature.
