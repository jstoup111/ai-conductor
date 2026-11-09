# ADR: Composer runs checkpoint to the spec branch and resume anywhere

**Date:** 2026-11-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer session (#2050)
**Related:** adr-008-agent-hosted-loop-and-in-chat-authoring,
adr-2026-07-03-engineer-checkpoint-commits-idempotent-land, adr-2026-07-03-pr-timing-config-key,
adr-2026-07-29-ship-start-draft-pr, adr-012-durable-intake-ledger-sole-dedup-authority,
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D9–D11, compose launcher),
adr-2026-08-08-pipeline-owned-closeout-timestamps (D2, one writer per ledger),
adr-2026-07-04-claim-time-delivery-evidence-guard
**Amends:** adr-2026-07-03-pr-timing-config-key, adr-2026-07-03-engineer-checkpoint-commits-idempotent-land,
adr-2026-09-11-github-operation-ownership (D2), each with an additive amendment note

## Context

A Composer run (idea → DECIDE → spec handoff) lives entirely inside one interactive host session.
The PRD for #2050 requires a run to survive the end of any session. Any operator, on any machine, with
any provider that declares `interactiveLaunch`, must be able to continue it, and a draft spec PR must
make it findable by another person.

Verified facts that shape the design:

- **`land` is already idempotent about staging.** It stages `.docs` and commits only when something is
  staged, so artifacts committed earlier pass every gate unchanged (`land-spec.ts:903-916`).
  `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` decided checkpoint commits and a
  draft-PR-aware handoff. That decision sat behind the unimplemented `pr_timing` key;
  `adr-2026-07-29-ship-start-draft-pr` records that no `pr_timing` key or push primitive exists.
- **`handoff` always creates the PR.** It pushes, then runs `pull-request.create` with base `main`, so
  an existing PR for the branch makes it fail after the push (`handoff.ts:218-240`). The registry
  already has `pull-request.create` with `draft`, plus `pull-request.ready` and `pull-request.draft`
  (`github-operations.ts:102,255-256`); handoff uses none of the draft ones.
- **Every guarded push and PR write needs owner provenance.** The branch's committed
  `.docs/intake/<slug>.md` must carry an `Owner:` line equal to the machine owner
  (`owner-gate/mutation-policy.ts:122-167`). An exact, interactive explicit approval bypasses that
  owner check for one remote-ref push (`remote-git-operations.ts:303-325`). Today only `land` writes
  the marker (`intake-marker.ts:44-106`). The daemon builds a merged spec only when its committed
  owner stamp matches the daemon's owner (`daemon-backlog.ts:540-557`).
- **`compose worktree` cannot attach a remote-only branch.** It knows `reused` (registered worktree),
  `attached` (local branch) and `created` (new branch from base) only, and refuses a dirty leftover
  (`worktree-shared.ts:51-68`, `worktree-authoring.ts:101-119`).
- **The intake ledger is per machine** (`~/.ai-conductor/engineer/ledger.json`, `engineer-store.ts:180-188`).
  Stale-claim reaping fires only for `claimed` entries with no `prUrl` (`stale-claim.ts:12-21`). The
  delivery guard heals an entry whose PR is open to `done` (`delivery-guard.ts:307-439`); it does not
  distinguish a draft PR.
- **The launcher waits for the host to exit** inside a `for(;;)` loop, then asks whether to process
  another idea (`engineer-cli.ts:1288-1326`, `735-746`). It exports
  `AI_CONDUCTOR_AUTHORING_PROVIDER=<id>` to the session (`engineer-cli.ts:1252`).
- **Compose primitives already emit `ConductorEvent`s** into the target's
  `.pipeline/composer-events.jsonl` sibling ledger (land, plan-review, handoff;
  `engineer-cli.ts:1528-1823`). No event records a run's start, save, resume, or a deliberate
  provider change. The existing `provider_fallback` and `step_retry` events are scoped to engine
  pipeline steps (`types/events.ts:1306-1355`).

## Options Considered

### Option A: Spec-branch run record, guarded checkpoints, draft PR pickup surface (chosen)
- **Pros:**
  - Git holds the only state, and every operator machine can reach it.
  - Reuses land's idempotence, the guarded publication, the owner gate, the draft and ready
    operations, and the composer event ledger.
  - The human-gated loop of ADR-008 is untouched.
- **Cons:**
  - Adds three primitives and changes `worktree`, `land`, `handoff`, the delivery guard and the
    launcher.
  - The run record is a new contract.

### Option B: Draft PR body and comments as the run state
- **Pros:** visible without git.
- **Cons:**
  - Machine-reading PR prose is a second, fragile state store beside git.
  - Every state change becomes a GitHub write.
  - It is rejected at explore.

### Option C: Engine-coordinated bounded provider turns (filer hypothesis)
- **Cons:**
  - It is the one-shot authoring ADR-008 Option B rejected, so it breaks clarity loops.
  - It does not hand off to another person.
  - It is rejected at explore.

### Option D: Implement the `pr_timing` key and make checkpoints opt-in
- **Cons:**
  - FR-28 makes checkpointing the normal path for every run, so an opt-in key would leave resume
    and hand-off unavailable by default.
  - The key also carries a 22-task build-flow half that this feature does not need. This is the same
    reasoning `adr-2026-07-29-ship-start-draft-pr` used to hard-code its timing.

## Decision

### D1 — Composer runs always checkpoint; no configuration key
The Composer flow commits and publishes its DECIDE progress unconditionally. It adopts the checkpoint
and draft-aware-handoff decisions of `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land`
(its Decision items 1–3) for the Composer flow, with no `pr_timing` gate. The unimplemented
`pr_timing` key, if it is ever built, governs only the daemon build flow. This narrows the engineer
half of `adr-2026-07-03-pr-timing-config-key` the same way `adr-2026-07-29-ship-start-draft-pr`
narrowed its ship half.

Both 2026-07-03 ADRs said that with the key absent the engineer flow stays byte-identical to today.
This decision falsifies that statement, so each carries an additive amendment note recording that it no
longer describes the Composer flow. The `pr_timing` feature was never built: PR #267 closed unmerged,
and #199 is closed.

### D2 — The run record is engine-owned durable state on the spec branch
Each run has one engine-owned JSON record at `.docs/composer-runs/<slug>.json`. It is committed on
`spec/<slug>` and carries:
- `schemaVersion` and `slug`;
- the optional `sourceRef`;
- the ordered DECIDE steps, each `accepted` or `draft`, with the accepting actor, the provider, the
  time, and the path plus SHA-256 digest of every artifact it accepted;
- `needsReconfirm` step ids;
- the owner history;
- operator decisions and open questions, as text the session supplies through a notes file.

It is state under event-spine exception C: the record is read by name as the authority for where a
run resumes and what is accepted. Occurrences are emitted separately (D10). The record is never
derived from the PR or from chat. `land` strips it (D7), so the base branch never carries it.

### D3 — Acceptance is digest-bound, so an unaccepted draft is mechanically detectable
An artifact counts as accepted only while its current content digest equals a digest recorded for an
accepted step.
- **Draft.** Any `.docs` DECIDE artifact in the run's change set whose digest is not recorded as
  accepted is a draft. This holds for every artifact family, including the track and complexity
  files, which have no status line.
- **Edited after acceptance.** Editing an accepted artifact makes its step a draft again. Every later
  accepted step is marked `needsReconfirm` until the operator re-accepts it.
- **Untouched.** The plan-review record and `.docs/coherence/.gitkeep` keep their existing land
  treatment and are never digest-tracked.

### D4 — `compose checkpoint` saves a step through the guarded publication
`compose checkpoint --worktree <p> --step <step> (--accept | --draft) [--notes-file <f>]` runs
inside the per-idea worktree.
- **Commit.**
  - It stages only `.docs`, using land's path discipline.
  - On the first checkpoint it writes the intake owner marker (`writeIntakeMarker`), so provenance
    exists before the first push. The marker is keyed by the run's slug, and land already requires the
    plan stem to equal that slug, so land later rewrites the same marker rather than creating a second
    one.
  - It fails closed when the machine owner cannot be resolved: no marker, commit or push.
  - It updates the record with digests, actor, and provider from `AI_CONDUCTOR_AUTHORING_PROVIDER`,
    recorded as `unrecorded` when that is absent.
  - It commits.
- **Publish.** It pushes through `executeRemoteGit` with a plain push, never forced. It uses the same
  guarded publication and write credential (the configured bot, falling back to the operator) that
  `handoff` uses.
  - A non-fast-forward rejection keeps the local commit. It reports that the remote moved and names
    `compose resume` as the way to take the newer progress.
  - Remote unreachable or the write refused: local work is kept, the step is reported as unsaved
    remotely, and retrying is idempotent.
- **No remote.** It commits locally only, consistent with ADR-008 D6.

### D5 — The first published checkpoint opens one draft spec PR; later ones refresh a rendered block
- **First publication.** It creates the PR with `pull-request.create` and `draft: true`. The body is
  composed with the repository's release-metadata section already present, so the required metadata
  check passes from the start. For an intake idea the body also carries the non-closing
  `Refs <owner/repo#N>` line.
- **Later checkpoints.** Each one upserts a marker-delimited "Composer run" block in the PR body
  (`pull-request.edit`) and preserves the rest of the body. The block shows:
  - the current step;
  - the accepted steps, with actor and provider;
  - the active provider and the last actor and time;
  - the open questions and the next step.
- **Display only.** The block is never parsed back. Each refresh re-runs the required PR body check;
  that cost is accepted.
- **One PR per branch.** Before creating, the checkpoint looks up an existing PR for
  `spec/<slug>` and reuses it.

### D6 — `compose resume` attaches a run from the remote, on any machine, for any operator
`compose resume <PR number | PR URL | spec branch | owner/repo#N> [--provider <id>] [--project <name>]`
works in these steps:
- **Step 1 — find the run.**
  - A PR yields its head branch. A branch is used as given.
  - An intake ref uses the local ledger's branch; failing that, an open spec PR that cross-references
    the issue.
  - The project is matched in the local registry by remote URL, or taken from `--project`. An
    unregistered project fails closed with a diagnostic.
- **Step 2 — attach.**
  - Fetch `origin spec/<slug>` and attach `.worktrees/engineer-<slug>`.
  - A new `fetched` reconcile creates the local branch tracking the remote when only the remote
    exists.
- **Step 3 — local leftovers.**
  - If the local branch or worktree holds unsaved or diverged work, resume never discards, overwrites
    or lands it silently.
  - It shows both sides and the operator chooses. They can keep the local work, which must
    fast-forward the remote or the resume refuses. Or they can discard it, after resume saves a local
    backup branch `composer-backup/<slug>-<timestamp>`, including a WIP commit of any dirty files.
- **Step 4 — ledger.** Resume records the local ledger entry as `deciding` with the branch and PR
  (D9).
- **Step 5 — launch.** It launches the chosen provider's interactive host on the same path as the
  launcher, with the resume prompt (D8). That path keeps the launcher's existing refusal to start a host
  inside another host session.

### D7 — `land` enforces acceptance and strips the record; `handoff` readies the existing draft
- **`land` with a record.** After its existing gates, `land` refuses with a new `unaccepted-draft`
  rejection while any change-set artifact is a draft or any step is `needsReconfirm` (D3). Otherwise
  it removes the record in its own commit.
- **`land` re-runs.** A later re-run with no record present verifies against the record as of that
  strip commit's parent. Any edit made after the strip is therefore still refused.
- **`handoff`.** It pushes as today. When an open PR for `spec/<slug>` exists, it updates the title
  and body to the land format and calls `pull-request.ready` instead of `pull-request.create`; with no
  PR it falls back to create.
  - Both paths return the existing `pr-opened` result with the PR URL.
  - Labels, `Refs`, release metadata, ledger `done`, and the single `ensureRunning` are unchanged.
  - If marking the PR ready fails, handoff exits non-zero, keeps the worktree, and leaves the ledger
    entry un-`done`. A re-run is idempotent.
- **Runs that predate this ADR.** A run with no record and no strip commit lands exactly as today.

### D8 — The launcher guides the boundary between sessions
- **Correlating runs.** The launcher exports a per-launch id. `compose worktree` and `compose resume`
  emit `composer_run_started` / `composer_run_resumed` carrying that id and the worktree path into the
  target's composer event ledger.
- **After the host exits.** The launcher finds the runs its session touched from those events. For
  each unfinished run it first auto-saves uncommitted `.docs` as a `--draft` checkpoint. It then shows
  the current step and active provider and offers three choices:
  - continue with the same provider;
  - switch to another provider that declares `interactiveLaunch` in the provider catalog. The list
    comes from the catalog without probing; a provider that is unavailable fails at launch and the
    choices are offered again;
  - hand off and stop.
- **Continue or switch.** Both relaunch the host with the Composer skill in resume mode for that
  worktree.
- **Non-TTY.** The default is hand off.
- **No run touched.** The existing "process another idea" prompt is unchanged.
- **Prompt order.** The run-boundary prompt comes first. Once that run is handed off or delivered,
  the existing "process another idea" prompt follows.
- **Host for new ideas.** New ideas still launch on the host selected when the launcher started. A
  switch applies only to the run being resumed.

### D9 — Cross-machine de-duplication extends the ledger, which stays the dedup authority
- **First published checkpoint.** It moves the ledger entry to `deciding` with the branch and the
  draft PR's URL. The URL goes in a new optional `draftPrUrl` field, never in `prUrl`, which stays
  delivery evidence written only by `reportDone` and `resolve`.
- **Why that is enough to hold the run.** Under
  adr-2026-07-04-claim-time-delivery-evidence-guard D1, an entry beyond `pending` with no `prUrl` is
  already held as in-flight elsewhere, so its duplicate envelopes are dropped. Stale-claim reaping
  ignores it, because it only reaps `claimed`. Neither of those behaviors changes.
- **Additive delivery-guard handling of `draftPrUrl`:**
  - a PR that is now ready or merged heals the entry to `done`, copying the URL into `prUrl`;
  - a PR closed unmerged reopens the entry to `pending`, under the existing re-eligibility cap;
  - a lookup failure holds the entry.
- **Unrecorded candidates.** A pending candidate with no ledger history whose issue is
  cross-referenced by an open spec PR is recorded as `deciding` with that `draftPrUrl` and is not
  claimed. If the cross-reference lookup fails, the candidate is skipped and stays `pending`, never
  served on uncertainty, matching adr-2026-07-04 D1's lookup-failure rule. A candidate with no
  cross-reference is served exactly as today.
- **Assignees.** No path changes the source issue's assignees.

### D10 — Run transitions extend the event spine
New `ConductorEvent` kinds are written to the existing `.pipeline/composer-events.jsonl` sibling
ledger, the same schema and one writer per file, under adr-2026-08-08-pipeline-owned-closeout-timestamps
D2:
- `composer_run_started`
- `composer_run_checkpointed`, with `state: accepted | draft` and a `published` outcome
- `composer_run_resumed`, with the previous and new actor and provider and an ownership outcome
- `composer_provider_switched`, with `fromProvider`, `toProvider`, step and actor
- `composer_run_handed_off`

Every kind is registered in `EVENT_SINKS`. A deliberate switch is a distinct kind, never
`provider_fallback` or `step_retry`. These events cover run transitions only; per-step DECIDE
lifecycle stays with #1975.

### D11 — A different operator's resume asks whether to take over build ownership
When the resuming machine's owner differs from the committed `Owner:`, resume asks interactively
whether to take over building the delivered spec. There is no lock, and no consent from the previous
owner is needed. This amends adr-2026-09-11-github-operation-ownership D2 with a take-over exception.
It applies only to an operator-run `compose resume` outside every engine-dispatched session, on a
pre-merge spec branch.
- **Yes.**
  - Resume commits the marker re-stamped to the new owner and appends the owner history to the run
    record. The history is JSON fields, never an `Owner:` line, so there is only one owner record.
  - It pushes that commit under one exact, one-request interactive explicit approval bound to that
    remote ref and the push operation.
  - The following saves then pass the ordinary committed-owner check, and the new owner's daemon builds
    the merged spec.
- **No.** The owner is unchanged and resume continues in local-only mode. Checkpoints commit locally
  and no remote write to that branch or its PR is attempted, which honors D2. Each save says the run is
  owned by the other operator and that taking over is how to publish.
- **Non-interactive.** There is no take-over prompt, so resume by a non-owner continues local-only.
- **Daemon and engine sessions** never take over.

### D12 — Delivery is split into two sequential specs
- **This spec** delivers D1–D11, and it ships live with no flag, because it is complete without
  comment resolution.
- **A follow-up spec, blocked by this one**, delivers PR review-comment resolution:
  - FR-16 to FR-20, and the comment half of FR-26;
  - read operations for review and conversation comments, sanitized through `sanitizeInboundText`
    with a `{kind:'github'}` work ref for the PR number;
  - per-comment dispositions stored in the run record, and replies on the PR;
  - a `handoff` gate on comments that have no disposition.
- **Outcome coverage.** The outcomes the follow-up delivers are waived in this spec's coherence
  mapping, naming the follow-up as their home.

### D13 — ADR-008 is retained, not amended
ADR-008 D2 ("the host agent runs the long-lived loop") and D4 (human-gated clarity loops) still hold.
A run now spans several host sessions, each of them a host-agent loop under the same gates. Resume
never authors and never skips a gate. No ADR-008 decision text is falsified, so no amendment note is
added.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `land` commits only when something is staged, so already-checkpointed artifacts pass every gate (`land-spec.ts:903-916`) | verified | 95% | yes | Land would fail on an empty stage after checkpoints | n/a (verified) |
| A2 | An exact interactive explicit approval authorizes one remote-ref push without the owner check (`remote-git-operations.ts:303-325`) | verified | 90% | yes | The D11 take-over push could not be published | n/a (verified) |
| A3 | Once the take-over commit is on the remote, owner provenance for later pushes and PR writes resolves to the new owner, because committed spec-branch provenance is authoritative before merge (adr-2026-09-11-github-operation-ownership D2; handoff reads `git show spec/<slug>:.docs/intake/<slug>.md`) | inferred | 75% | yes | Every later save by the new owner would also need an explicit approval; a plan task verifies this | APPROVED by operator 2026-11-07 |
| A4 | An open spec PR whose body carries `Refs owner/repo#N` appears as a cross-reference on that issue, readable through the existing GraphQL read operation, without search-index lag | inferred | 70% | yes | A third machine could claim an issue already in flight elsewhere (FR-23) | APPROVED by operator 2026-11-07 |
| A5 | The daemon discovers specs only from base-branch `.docs/plans`, so pushed unmerged spec branches are invisible to it (`daemon-backlog.ts:72,112`) | verified | 95% | yes | The daemon could build a half-authored spec | n/a (verified) |
| A6 | Nothing outside `land` reads `.docs/composer-runs/`, so a committed run record on the spec branch disturbs no other gate (land filters the change set to `.docs` and has no unknown-directory rejection; coherence and plan-review were not read) | inferred | 70% | no | A gate may need to exclude the directory, a bounded plan task | n/a (not load-bearing) |

## Consequences

### Positive
- A run survives any session end. Another provider, machine or person continues it from git, and the
  draft PR shows where it stands.
- Unaccepted work is mechanically unlandable, for every artifact family.
- Deliberate switches, resumes and saves are visible to every spine consumer.
- `handoff` stops failing when a spec PR already exists, a defect that was observed independently.

### Negative
- `handoff` has two publish paths, create and ready-existing, to test.
- Every accepted step is a remote write, so DECIDE is slower on a slow network. A failed push is
  non-fatal and retryable.
- The spec PR's history shows per-step checkpoint commits, and the run record is added then removed
  on the branch.
- An operator who declines ownership pays one interactive approval per remote write.

### Follow-up Actions
- [ ] Spec 1 (this spec): D1–D11 per the plan.
- [ ] File the follow-up intake for D12's comment-resolution spec, blocked by this one.
- [ ] Composer skill: checkpoint after each accepted step, and a resume mode.
