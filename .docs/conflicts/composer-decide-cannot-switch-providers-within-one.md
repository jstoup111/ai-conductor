# Conflict Check: Composer runs checkpoint, resume, switch provider, and hand off (#2050, spec 1)

**Date:** 2026-11-07
**Inventory:**
- The new stories `.docs/stories/composer-decide-cannot-switch-providers-within-one.md` (14 stories).
- A keyword sweep of all 680 story files. 306 matched land, handoff, worktree, ledger, delivery guard,
  owner, composer, and launcher terms; about 50 candidate files were read.
- The PRD, the specs, and prior `.docs/conflicts/` reports.

**ADR corpus:** repository-wide. Narrowed in:
- adr-008-agent-hosted-loop-and-in-chat-authoring
- adr-2026-06-30-engineer-worktree-authoring-isolation
- adr-012-durable-intake-ledger-sole-dedup-authority
- adr-2026-07-04-claim-time-delivery-evidence-guard
- adr-2026-07-22-stale-claim-staleness-window-default
- adr-2026-07-22-requeue-claimed-distinct-from-reopen
- adr-2026-07-03-pr-timing-config-key
- adr-2026-07-03-engineer-checkpoint-commits-idempotent-land
- adr-2026-07-29-ship-start-draft-pr
- adr-2026-07-21-owner-stamped-at-authoring
- adr-2026-09-11-github-operation-ownership
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
- adr-2026-08-08-pipeline-owned-closeout-timestamps
- adr-2026-11-07-composer-run-checkpoint-resume-handoff

All other ADRs were narrowed out as unrelated to Composer run state, publication, intake, or launching.
No fully superseded ADR was excluded.

**Result:** **PASS. Zero blocking conflicts remain.**
- One blocking ADR-versus-story conflict was resolved by an operator-selected amendment to
  adr-2026-09-11-github-operation-ownership D2.
- Two ADR-and-story contradictions with the unbuilt `pr_timing` spec were resolved by amendment notes.
- One delivery-guard contradiction was resolved by changing this spec's design, with no change to the
  existing artifacts.
- Ten degrading items were resolved in this spec's own draft stories and ADR.

## Conflict: Teammate take-over writes to another owner's spec branch

**Stories involved:** "Identify the operator and exact mutation target" (Story 1) vs this spec's Story 14
**Files:** `.docs/stories/enforce-ownership-across-all-harness-github-operat.md` vs `.docs/stories/composer-decide-cannot-switch-providers-within-one.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-09-11-github-operation-ownership
**Story ID:** Story 14
**ADR opposing sentence (verbatim):** "Existing feature PRs and remote feature branches require a single unambiguous committed intake owner matching the machine-resolved operator. […] Another operator's resources are neither healed nor cleared."
**Story opposing sentence (verbatim, before resolution):** "Given B declined the take-over, when B checkpoints, then each push and PR write asks B for the one-request interactive approval, and the owner remains A."

**Description:** A non-owner's repeated writes to the owner's branch, and an unapproved re-stamp, both
contradict D2's committed-owner rule.

**Resolution Options:**
1. Amend D2 with a narrow operator-run take-over exception. The take-over happens only on a pre-merge
   spec branch, never in a daemon or engine session, after an interactive confirmation. The re-stamp
   push goes out under one exact explicit approval, and declining leaves the operator local-only.
2. Allow no teammate writes at all, so a teammate can only resume locally.
3. Let a teammate continue on a new branch, which duplicates the spec PR.

**Recommendation and operator decision (2026-11-07):** Option 1.
- adr-2026-09-11-github-operation-ownership D2 now carries an additive amendment note.
- In this spec's drafts, the ADR's D11, the PRD's FR-31, and Story 14 were revised so that declining
  makes no remote write.
- The existing ownership Story 1 is left unchanged: the owner-policy evaluation it specifies is
  unchanged. The take-over push uses the pre-existing exact explicit-approval path for a remote-ref
  push (`remote-git-operations.ts:303-325`), now sanctioned for take-over by the D2 amendment.

## Conflict: Draft spec PR healed to done by the claim-time delivery guard

**Stories involved:** "Delivered entry is never re-served — auto-heal to done" (TR-1) vs this spec's Story 11
**Files:** `.docs/stories/engineer-claim-delivery-guard.md` vs `.docs/stories/composer-decide-cannot-switch-providers-within-one.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-04-claim-time-delivery-evidence-guard
**Story ID:** Story 11
**ADR opposing sentence (verbatim):** "**OPEN or MERGED** → the idea is delivered: auto-heal the entry to `done`"
**Story opposing sentence (verbatim, before resolution):** "Given a `deciding` entry whose spec PR is still an open draft, when the delivery guard verifies it, then the entry is held as in flight and is not healed to `done`."
**Existing (verbatim):** "Given entries stranded at `routed` or `deciding` with a recorded `prUrl` whose PR is OPEN, when `engineer claim` runs, then they are healed and skipped identically"

**Resolution Options:**
1. Record the draft PR in a separate `draftPrUrl` field and never in `prUrl`. The entry is then
   "beyond `pending` with no `prUrl`", which adr-2026-07-04 D1 already holds in flight, and the
   existing artifacts stay true.
2. Amend adr-2026-07-04 D1 and TR-1 to heal only a non-draft OPEN PR.

**Recommendation and operator decision (2026-11-07):** Option 1. This spec's ADR D9 and Story 11 were
revised, and the existing ADR and story are unchanged.

## Conflict: Checkpointing is always on vs the unbuilt `pr_timing` opt-in

**Stories involved:** TS-6, TS-7 and TS-8 in `.docs/stories/make-daemon-build-push-pr-timing-a-configurable-st.md` vs this spec's Stories 1, 3, 12 and 13
**Type:** contradiction
**Severity:** degrading. The feature was never built: PR #267 closed unmerged, and #199 is closed.
**ADR filename stem:** adr-2026-07-03-pr-timing-config-key (also adr-2026-07-03-engineer-checkpoint-commits-idempotent-land)
**Story ID:** Story 13
**ADR opposing sentence (verbatim):** "**D1** — Option A: one top-level key `pr_timing` in `.ai-conductor/config.yml`, with `finish` the default (current behavior) and `early-draft` the alternative."
**Story opposing sentence (verbatim):** "the only visible differences from before are per-step saves and the spec PR starting as a draft."
**Existing (verbatim):** "Given `pr_timing: finish` (or key absent) in the target repo, when every skill boundary passes, then zero commits and zero pushes occur before `land` — authoring is byte-identical to today."

**Resolution Options:**
1. Add amendment notes to both 2026-07-03 ADRs saying the Composer flow checkpoints unconditionally,
   and record the dead stories as superseded here.
2. Also rewrite TS-6, TS-7 and TS-8 in place.

**Recommendation and operator decision (2026-11-07):** Option 1.

These TS criteria are superseded for the Composer flow:
- TS-6's skip-in-finish-mode, its exclusion of stray files at commit, and its advisory-only push
  failure;
- TS-7's "no new commit", because land now strips the run record;
- TS-8's write-back after a failed mark-ready.

## Degrading items resolved in this spec's own drafts

| Existing | New | Resolution |
|---|---|---|
| `engineer-handoff-pushes-spec-branch-331.md` TECH-1 (create follows push, `pr-opened` result) | Story 12 | The ready path returns the same `pr-opened` result; the no-PR fallback keeps push-then-create |
| `2026-07-03-intake-marker-plan-stem-keying.md` Story 1 (marker keyed by the plan stem) | Story 1 | The marker is keyed by slug, which land already requires to equal the plan stem; no second marker |
| `engineer-claim-delivery-guard.md` (no friction on the healthy path; a lookup failure is skipped) | Story 11 | A candidate with no cross-reference is served as before; a failed lookup is skipped and stays pending |
| `phase-9.3b-github-intake-writeback.md` Story 8 (the lifecycle order) | Story 11 | Entering `deciding` directly is allowed, since recovery for an abandoned draft is the PR closed-unmerged reopen or `compose forget` |
| `compose-launcher-honors-llm-provider-for-codex.md` TI-5 (the host is kept for later ideas) | Story 6 | New ideas use the host selected at launch, and the run prompt comes before the another-idea prompt |
| Same file, TI-4 (nested-host refusal) | Story 7 | Resume refuses to nest a host |
| Same file, TI-3 (no provider probe before the spawn) | Story 6 | The switch list is catalog-only, with no probe |
| `compose-the-spec-pr-body-with-its-release-disposit.md` Story 1 (no extra body edit after create) | Stories 4 and 5 | The draft is created with release metadata; checkpoint refreshes re-run the required check, accepted by the operator |
| `use-a-dedicated-bot-identity-for-daemon-github-act.md` Story 3 (remote writes run as the bot) | Story 1 | Checkpoint pushes use handoff's guarded publication and credential |
| `multi-operator-ownership-slice-b.md` Story 2 (an unresolved identity writes no marker) | Story 1 | A checkpoint refuses before writing any marker when the identity is unresolved |

`engineer-worktree-isolation.md` FR-1, FR-4 and FR-11 are compatible: `compose worktree`'s behavior is
unchanged, and only `compose resume` attaches a remote branch and keeps backups.

## Oscillation check

Each pair sharing a gate was tested in both directions; none oscillates:
- land's acceptance gate vs idempotent land;
- the delivery guard vs stale reaping vs the draft hold;
- owner checks vs take-over;
- checkpoint refusal outside `.docs` vs the launcher auto-save. The auto-save is reported as unsaved,
  and it never forces.
