# Implementation Plan: Composer runs checkpoint, resume, switch provider, and hand off (#2050, spec 1)

**Date:** 2026-11-07
**Design:** .docs/specs/composer-decide-cannot-switch-providers-within-one.md
**Stories:** .docs/stories/composer-decide-cannot-switch-providers-within-one.md
**Conflict check:** Clean as of 2026-11-07

## Summary

The plan has 18 tasks, delivered as a single PR. They add three things:
- a run record and its digest-bound acceptance;
- `compose checkpoint`, which commits, publishes and keeps a draft spec PR;
- `compose resume`, with leftover handling and the ownership take-over.

They also change `land` (the unaccepted-draft gate and the record strip), `handoff` (ready an existing
draft), the delivery guard and claim (`draftPrUrl`), and the worktree reconcile (`fetched`). The
launcher gains a session boundary (auto-save and continue / switch / hand off), five `composer_*`
events are added, and the Composer skill is updated. Review-comment resolution is out of scope; it
belongs to the follow-up spec (ADR D12).

## Technical Approach

- **Run record** (`src/conductor/src/engine/engineer/run-record.ts`).
  - It lives at `.docs/composer-runs/<slug>.json`.
  - Its typed model:
    - `RunStep` is a discriminated union, `{state:'accepted', actor, provider, at, artifacts}` or
      `{state:'draft'}`;
    - `ArtifactDigest` is `{path, sha256}`;
    - the record also has `needsReconfirm: StepId[]`, `ownerHistory[]` and `notes`.
  - Pure functions handle parse and serialize, compute digests, and `classifyArtifacts`, which
    returns accepted, draft and needs-reconfirm.
  - Only engine code writes the record. It never contains an `Owner:` line.
- **Checkpoint** (`src/conductor/src/engine/engineer/checkpoint.ts`, reached through the new `compose
  checkpoint` dispatch in `engineer-cli.ts`).
  - It follows the land path discipline: it stages `.docs` and refuses any dirty path outside `.docs`.
  - On the first checkpoint, `writeIntakeMarker` writes the slug-keyed owner marker.
  - It commits, then publishes through `executeRemoteGit` with a plain push.
  - Draft PR create, refresh and ready go through `executeGithubOperation`
    (`pull-request.create` with `draft:true`, `pull-request.edit`, `pull-request.ready`).
  - It never runs raw `gh` or `git` writes and never forces.
- **Resume** (`src/conductor/src/engine/engineer/resume.ts`, through `compose resume`).
  - The target is parsed once into `{kind:'pr'|'branch'|'intake'}`.
  - The project is resolved from the registry by remote URL.
  - It fetches, then attaches through the new `fetched` reconcile in `src/conductor/src/engine/worktree-shared.ts`.
  - It handles leftovers and the ownership take-over.
  - It launches the host through the same spawn path as the launcher.
- **Ledger** (`src/conductor/src/engine/engineer/intake/ledger.ts`). Ledger entries gain an optional
  `draftPrUrl`; `prUrl` stays delivery evidence only. The delivery guard
  (`src/conductor/src/engine/engineer/intake/delivery-guard.ts`) handles `draftPrUrl` additively,
  and claim adds the cross-reference check through the existing `ambient.graphql.read` operation.
- **Launcher** (the `launch` case loop in `engineer-cli.ts`).
  - It exports `AI_CONDUCTOR_COMPOSE_LAUNCH_ID`.
  - After the host exits, it reads the target's `.pipeline/composer-events.jsonl` for
    `composer_run_started` / `composer_run_resumed` events carrying that id.
  - It auto-saves drafts, then prompts with a discriminated `BoundaryChoice` of `continue`,
    `switch(provider)` or `handoff`.
- **Events.** Each of the five new kinds is added to the `ConductorEvent` union
  (`src/conductor/src/types/events.ts`) and to `EVENT_SINKS`
  (`src/conductor/src/engine/event-sinks.ts`).
- **Pattern context.**
  - Mirror how `openSpecPr` in `handoff.ts` builds `deps.publication` and how it runs
    `executeGithubOperation` / `executeRemoteGit`. Keep the same injected `CommandRunner` seams so
    tests mock the process boundary.
  - Mirror the existing `engineer-cli-*.test.ts` dispatch tests for CLI parsing and dispatch.
  - Search hints: `openSpecPr`, `executeRemoteGit`, `parseEngineerCommand`, `spawnInteractiveHost`,
    `createDeliveryGuardedQueue`.
- **Test isolation.** Every test mocks git and gh at the injected runner boundary; none reaches a real
  remote or a real host binary.

## Prerequisites

- The on-main ADR amendment notes are committed on this branch (`spec: amend …`).

## Tasks

### Task 1: Run record model and digest-bound acceptance
**Story:** Story 1
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/run-record.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `run-record.ts`:
   - typed `RunRecord` / `RunStep` / `ArtifactDigest`;
   - `parseRunRecord` / `serializeRunRecord`;
   - `digestArtifact(path, bytes)`;
   - `recordAcceptance`;
   - `classifyArtifacts(record, currentDigests)`.
4. Verify GREEN, then commit.

**Done when:**
- [test] `recordAcceptance` writes an accepted step carrying actor, provider, acceptance time, every artifact path with its SHA-256 digest, and the supplied decisions and open questions, and `serializeRunRecord` round-trips it through `parseRunRecord` unchanged.
- [test] `classifyArtifacts` reports a change-set artifact whose current digest is not recorded as accepted as draft, including a track or complexity path with no status line.
- [test] `classifyArtifacts` reports the stories step as draft and every later accepted step (the plan step) as needs-reconfirm after an accepted stories artifact's digest changes.
- [test] `parseRunRecord` rejects a record with an unknown schemaVersion or a step state outside accepted and draft, and a serialized record never contains an `Owner:` line.

**Files likely touched:**
- `src/conductor/src/engine/engineer/run-record.ts` — new module
- `src/conductor/test/engine/engineer/run-record.test.ts` — new tests

**Dependencies:** none

### Task 2: Composer run transition events
**Story:** Story 10
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` for every Done-when check below.
2. Verify RED.
3. Add these to the `ConductorEvent` union, each with an `EVENT_SINKS` entry:
   - `composer_run_started` {slug, worktreePath, launchId?, provider, actor};
   - `composer_run_checkpointed` {slug, step, state, published, provider, actor};
   - `composer_run_resumed` {slug, provider, actor, previousProvider?, previousActor?, ownership};
   - `composer_provider_switched` {slug, step, fromProvider, toProvider, actor};
   - `composer_run_handed_off` {slug, actor, prUrl?}.
4. Verify GREEN, then commit.

**Done when:**
- [test] each of the five `composer_*` kinds is a member of the `ConductorEvent` union and has an `EVENT_SINKS` entry, so the `satisfies Record<ConductorEvent['type'], SinkDeclaration>` check compiles and the sink test enumerates all five.
- [test] `composer_provider_switched` carries `fromProvider`, `toProvider`, step, actor and slug, and it is a distinct kind from `provider_fallback` and `step_retry`, whose shapes are unchanged, and a source-scan test finds `composer_provider_switched` emitted only from `engineer-cli.ts`, so provider fallback and retry escalation produce no `composer_provider_switched` event.
- [test] an availability fallback still emits `provider_fallback` and a retry escalation still emits `step_retry`, as asserted by the unchanged emission cases in `test/engine/provider-execution.test.ts` and `test/engine/conductor-loop-policies.test.ts` passing with no `composer_provider_switched` event in their captured streams.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — five new kinds
- `src/conductor/src/engine/event-sinks.ts` — sink entries
- `src/conductor/test/engine/event-sinks.test.ts` — tests
- `src/conductor/test/engine/provider-execution.test.ts` — assert no switch event in fallback stream
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — assert no switch event in retry stream

**Dependencies:** none

### Task 3: `compose checkpoint` local commit
**Story:** Story 1
**Story:** Story 2
**Story:** Story 13
**Story:** Story 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/checkpoint.test.ts` (mocked git runner) and `src/conductor/test/engine/engineer/engineer-cli-checkpoint.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the parse and dispatch for `compose checkpoint --worktree <p> --step <step> (--accept | --draft) [--notes-file <f>]`, adding it at all five CLI points in `engineer-cli.ts`.
4. Implement the commit:
   - fail closed on an unresolved machine owner before any write;
   - refuse dirty paths outside `.docs`;
   - on the first checkpoint, write the slug-keyed owner marker with `writeIntakeMarker`;
   - update the record, taking the provider from `AI_CONDUCTOR_AUTHORING_PROVIDER` or recording `unrecorded`;
   - stage only `.docs` and commit;
   - skip an empty stage with no commit;
   - emit `composer_run_checkpointed` into `<target>/.pipeline/composer-events.jsonl`;
   - in a project with no remote, commit only.
5. Verify GREEN, then commit.

**Done when:**
- [test] running `compose checkpoint --step explore --accept` through the CLI dispatch commits the step's `.docs` artifacts plus `.docs/composer-runs/<slug>.json` and the slug-keyed `.docs/intake/<slug>.md` owner marker naming the machine owner, and writes one `composer_run_checkpointed` event with state accepted to `<target>/.pipeline/composer-events.jsonl`.
- [test] `--draft` records the step as draft with no accepting actor and no accepted digests, and a run with no `.docs` changes produces no commit and attempts no push.
- [test] the checkpoint refuses before staging when dirty paths exist outside `.docs`, naming them, and refuses before writing any marker, commit or push when the machine owner is unresolved, naming the unresolved identity.
- [test] with `AI_CONDUCTOR_AUTHORING_PROVIDER` unset the accepted step records provider `unrecorded` and the checkpoint still exits zero, and in a project with no remote each accepted checkpoint commits locally, with that step's run-record entry in the local commit, and issues no push and no PR call.

**Files likely touched:**
- `src/conductor/src/engine/engineer/checkpoint.ts` — new module
- `src/conductor/src/engine/engineer-cli.ts` — subcommand registration and dispatch
- `src/conductor/test/engine/engineer/checkpoint.test.ts` — new tests
- `src/conductor/test/engine/engineer/engineer-cli-checkpoint.test.ts` — new CLI tests

**Dependencies:** Task 1, Task 2

### Task 4: Checkpoint publication through the guarded push
**Story:** Story 1
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/checkpoint-publish.test.ts` (mocked `executeRemoteGit` runner) for every Done-when check below.
2. Verify RED.
3. Implement the publication:
   - a plain `push -u origin HEAD:refs/heads/spec/<slug>` through `executeRemoteGit` with feature provenance and the write credential `handoff` uses;
   - map a non-fast-forward rejection to a diagnostic naming `compose resume`;
   - map an unreachable remote or a refusal to a non-zero exit that keeps the local commit;
   - on retry, push the existing commit without re-recording the step.
4. Verify GREEN, then commit.

**Done when:**
- [test] an accepted checkpoint with a reachable remote invokes `executeRemoteGit` once with a plain push of `spec/<slug>` using the `write` credential and no `--force` or `--force-with-lease`, before the command returns success.
- [test] a non-fast-forward rejection leaves the remote ref unchanged, keeps the local commit, exits non-zero, prints the `compose resume` command, and never issues a forced retry.
- [test] an unreachable remote keeps the local commit, exits non-zero with the failed push and the retry command, reports the step as not saved remotely, and a retry pushes that same commit without creating a second commit, branch, or run-record step entry.

**Files likely touched:**
- `src/conductor/src/engine/engineer/checkpoint.ts` — publication
- `src/conductor/test/engine/engineer/checkpoint-publish.test.ts` — new tests

**Dependencies:** Task 3

### Task 5: Draft spec PR at first publication and ledger `deciding`
**Story:** Story 4
**Story:** Story 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/checkpoint-draft-pr.test.ts` (mocked `executeGithubOperation`) for every Done-when check below.
2. Verify RED.
3. After a successful push:
   - look up an open PR for `spec/<slug>` through a read operation;
   - if there is none, run `pull-request.create` with `draft:true`, base set to the default base, a body composed with the release-metadata section, and the non-closing `Refs <owner/repo#N>` line for intake runs;
   - on the first publication, transition the ledger entry to `deciding` with `branch` and `draftPrUrl`.
4. Verify GREEN, then commit.

**Done when:**
- [test] the first published checkpoint of an intake run issues exactly one `pull-request.create` with `draft: true` and base set to the repository's default base whose body contains the release-metadata section and `Refs <owner/repo#N>` with no closing keyword, and a non-intake run's first published checkpoint issues one `pull-request.create` with `draft: true` against the default base whose body has no `Refs` line.
- [test] later checkpoints find the existing open PR for `spec/<slug>` and never issue a second `pull-request.create`, and the checkpoint after a failed create finds no PR for the branch and issues exactly one `pull-request.create`, so exactly one open draft PR exists for the branch.
- [test] after the first published checkpoint the ledger entry is `deciding` with `branch` and `draftPrUrl` set and `prUrl` unset, and `isStaleClaim` returns false for it.

**Files likely touched:**
- `src/conductor/src/engine/engineer/checkpoint.ts` — PR create and reuse, ledger transition
- `src/conductor/src/engine/engineer/intake/ledger.ts` — use `draftPrUrl` in `transition`
- `src/conductor/test/engine/engineer/checkpoint-draft-pr.test.ts` — new tests

**Dependencies:** Task 4, Task 9

### Task 6: Composer run block in the PR body
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/run-pr-block.test.ts` and `src/conductor/test/engine/engineer/checkpoint-draft-pr.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `run-pr-block.ts`. `renderRunBlock(record)` renders a marker-delimited block. `upsertRunBlock(body, block)` replaces only the delimited region. The checkpoint calls `pull-request.edit` after each later publication, and a failed refresh is a warning.
4. Verify GREEN, then commit.

**Done when:**
- [test] after a checkpoint the PR body's Composer run block lists the current step, each accepted step with actor and provider, the active provider, the last actor and time, the open questions and the next step, all derived from the run record.
- [test] `upsertRunBlock` changes only the marker-delimited region and leaves the release-metadata section, the `Refs` line and every other body line byte-for-byte identical.
- [test] a failed `pull-request.edit` leaves the checkpoint reported as saved with a refresh warning, and the next checkpoint issues the refresh again.
- [test] no production code path parses the Composer run block, so resuming a run whose block was hand-edited takes step, decisions and acceptance only from the run record.

**Files likely touched:**
- `src/conductor/src/engine/engineer/run-pr-block.ts` — new module
- `src/conductor/src/engine/engineer/checkpoint.ts` — refresh call
- `src/conductor/test/engine/engineer/run-pr-block.test.ts` — new tests
- `src/conductor/test/engine/engineer/checkpoint-draft-pr.test.ts` — refresh tests

**Dependencies:** Task 5

### Task 7: Land refuses unaccepted drafts and strips the run record
**Story:** Story 3
**Story:** Story 13
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-run-record.test.ts` for every Done-when check below.
2. Verify RED.
3. In `landSpec`, after the existing gates:
   - if a record exists, classify the change-set `.docs` artifacts and throw `landGateError('unaccepted-draft')` for any draft or needs-reconfirm step;
   - otherwise `git rm` the record within land's commit;
   - when no record exists but the branch history has a land record-removal commit, classify against `git show <strip>^:.docs/composer-runs/<slug>.json`;
   - with neither, behave exactly as before.
4. Verify GREEN, then commit.

**Done when:**
- [test] `landSpec` with every change-set artifact matching an accepted digest and no needs-reconfirm step succeeds and its commit removes `.docs/composer-runs/<slug>.json`, leaving no run record at the branch tip.
- [test] `landSpec` refuses with `unaccepted-draft` naming the artifact for a change-set artifact whose digest is not accepted (including a track or complexity file), and names the stories step as draft and the plan step as needing reconfirmation after an accepted stories file is edited, making no commit in either case.
- [test] after re-acceptance of the edited stories step and reconfirmation of the plan step `landSpec` succeeds, and a re-run after the strip verifies against the strip commit's parent and refuses an artifact edited after the strip.
- [test] a branch with no run record and no record-removal commit lands exactly as before, as asserted by the unchanged `land-spec.test.ts` suite passing.

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — gate and strip
- `src/conductor/test/engine/engineer/land-spec-run-record.test.ts` — new tests

**Dependencies:** Task 1

### Task 8: Handoff readies the existing draft spec PR
**Story:** Story 12
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/handoff-ready-existing.test.ts` (mocked `executeGithubOperation`, `executeRemoteGit`) for every Done-when check below.
2. Verify RED.
3. In `openSpecPr`:
   - push as today, then look up an open PR for the branch;
   - when one exists, run `pull-request.edit` with the land-format title and body, release metadata and `Refs`, then `pull-request.ready`, and return the existing `pr-opened` result;
   - when the ready step fails, throw so the CLI keeps the worktree and skips `reportDone`;
   - when none exists, create as today.
4. Verify GREEN, then commit.

**Done when:**
- [test] `compose handoff` over a landed run with an open draft PR pushes the branch, issues `pull-request.edit` carrying the land-format title and body with the release-metadata section and the `Refs` line, then `pull-request.ready`, and no `pull-request.create`, prints the same `pr-opened` result with the PR URL, records the ledger entry `done`, applies `engineer:handled`, and calls `ensureRunning` once.
- [test] `compose handoff` with no existing PR for the branch pushes before issuing one `pull-request.create`, as before.
- [test] a failed `pull-request.ready` exits non-zero, keeps the worktree and leaves the ledger entry not `done`, and a re-run that succeeds leaves exactly one spec PR, one delivery comment and one `ensureRunning` call.
- [test] a re-run after a fully successful handoff creates no second PR, posts no second delivery comment and records no second ledger transition.

**Files likely touched:**
- `src/conductor/src/engine/engineer/handoff.ts` — ready-existing path
- `src/conductor/src/engine/engineer-cli.ts` — handoff result handling
- `src/conductor/test/engine/engineer/handoff-ready-existing.test.ts` — new tests

**Dependencies:** none

### Task 9: Delivery guard handles draft spec PRs
**Story:** Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/intake/delivery-guard.test.ts` and `src/conductor/test/engine/engineer/intake/ledger.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the optional `draftPrUrl` to `LedgerEntry` and accept it in `transition`. In the delivery guard, for an entry with `draftPrUrl` and no `prUrl`:
   - an open draft holds the entry and drops duplicate envelopes;
   - a ready or merged PR heals to `done`, copying the URL to `prUrl`;
   - a PR closed unmerged reopens to `pending` under `REOPEN_ATTEMPTS_CAP`;
   - a failed lookup holds the entry.
   The `prUrl` path is unchanged.
4. Verify GREEN, then commit.

**Done when:**
- [test] a `deciding` entry whose `draftPrUrl` PR is an open draft is held: `compose claim` drops its duplicate envelope, does not serve it, and leaves the entry `deciding` and not `done`.
- [test] a `deciding` entry whose `draftPrUrl` PR is ready or merged heals to `done` with `prUrl` set to that URL, and one whose PR was closed unmerged reopens to `pending` under the existing re-eligibility cap.
- [test] an entry with an open non-draft PR recorded in `prUrl` heals to `done` exactly as before, as asserted by the unchanged `engineer-cli-claim-delivery-guard.test.ts` cases passing.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/ledger.ts` — `draftPrUrl` field
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — draft handling
- `src/conductor/test/engine/engineer/intake/delivery-guard.test.ts` — tests
- `src/conductor/test/engine/engineer/intake/ledger.test.ts` — field tests

**Dependencies:** none

### Task 10: Claim records cross-referenced in-flight runs
**Story:** Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-claim-delivery-guard.test.ts` for every Done-when check below.
2. Verify RED.
3. In the delivery guard, for a pending github-issues candidate with no ledger history, read the issue's cross-referencing open PRs on `spec/*` heads through `ambient.graphql.read`:
   - a match records `deciding` with `draftPrUrl` and drops the envelope;
   - a failed lookup skips the candidate and leaves it `pending`;
   - no match serves the candidate unchanged.
4. Verify GREEN, then commit.

**Done when:**
- [test] `compose claim` with a pending candidate whose issue is cross-referenced by an open spec PR records the entry `deciding` with that `draftPrUrl` and returns no claim for it.
- [test] `compose claim` with a failed cross-reference lookup skips the candidate, leaves its ledger entry `pending` and never serves it, and a candidate with no cross-referencing spec PR is served exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — cross-reference check
- `src/conductor/test/engine/engineer/engineer-cli-claim-delivery-guard.test.ts` — tests

**Dependencies:** Task 9

### Task 11: `fetched` worktree reconcile for a remote-only branch
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-shared.test.ts` for every Done-when check below.
2. Verify RED.
3. In `ensureWorktree` reconcile, when there is no registered worktree and no local branch but `refs/remotes/origin/<branch>` exists, run `git worktree add --track -b <branch> <path> origin/<branch>` and return `fetched`.
4. Verify GREEN, then commit.

**Done when:**
- [test] with only `origin/spec/<slug>` present the reconcile returns `fetched` and creates a local `spec/<slug>` tracking `origin/spec/<slug>` checked out at the worktree path, not a fresh branch from base.
- [test] the `created`, `reused` and `attached` outcomes are unchanged, as asserted by the existing `worktree-shared.test.ts` cases passing.

**Files likely touched:**
- `src/conductor/src/engine/worktree-shared.ts` — `fetched` reconcile
- `src/conductor/test/engine/worktree-shared.test.ts` — tests

**Dependencies:** none

### Task 12: `compose resume` finds and attaches a run
**Story:** Story 7
**Story:** Story 8
**Story:** Story 11
**Story:** Story 2
**Story:** Story 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/resume.test.ts` and `src/conductor/test/engine/engineer/engineer-cli-resume.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the parse and dispatch for `compose resume <target> [--provider <id>] [--project <name>]`, adding it at all five CLI points, and `parseResumeTarget`:
   - a PR number or URL;
   - a `spec/` branch;
   - `owner/repo#N`, resolved through the ledger branch and then the cross-referencing open spec PR.
4. Implement the rest of resume:
   - resolve the project in the registry by remote URL, refusing an unregistered one before any fetch;
   - fetch `origin spec/<slug>` and attach through `ensureWorktree`;
   - read the run record and build the resume context: the first unaccepted step, accepted artifacts, decisions, open questions, drafts, and the last actor and time;
   - direct a landed run to delivery;
   - record the ledger entry `deciding` with branch and `draftPrUrl`;
   - emit `composer_run_resumed`.
5. Verify GREEN, then commit.

**Done when:**
- [test] `compose resume <PR number>`, `compose resume spec/<slug>` and `compose resume <owner/repo#N>` (resolved through the ledger branch and, when the ledger has none, through the open spec PR that cross-references the issue) each fetch `origin spec/<slug>` and attach the same `.worktrees/engineer-<slug>` tracking the remote branch, without asking for any release or permission from the run's last actor.
- [test] the resume context for a run with accepted explore and PRD steps and a draft architecture diagram names `architecture-diagram` as the first unaccepted step, lists the accepted artifacts, decisions, open questions and the draft, and shows the last actor and time, and a landed run's context names delivery as the next step.
- [test] an unknown target exits non-zero naming what was searched, an unregistered project refuses before any fetch naming the repository and the registration command, and a failed fetch exits non-zero with the fetch error, each leaving the filesystem and any existing worktree unchanged.
- [test] after resume on a machine with no ledger history the entry is `deciding` with the run's branch and `draftPrUrl`, and one `composer_run_resumed` event is written.
- [test] in a project with no remote, `compose resume spec/<slug>` on the same machine attaches the local branch without any fetch and the resume context names the first unaccepted step.

**Files likely touched:**
- `src/conductor/src/engine/engineer/resume.ts` — new module
- `src/conductor/src/engine/engineer-cli.ts` — subcommand registration and dispatch
- `src/conductor/test/engine/engineer/resume.test.ts` — new tests
- `src/conductor/test/engine/engineer/engineer-cli-resume.test.ts` — new CLI tests

**Dependencies:** Task 1, Task 2, Task 9, Task 11

### Task 13: Resume handles local leftovers
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/resume-leftovers.test.ts` for every Done-when check below.
2. Verify RED.
3. Before attaching, detect uncommitted `.docs` changes and local commits that are not on the remote, and present both sides. Then:
   - keep-local requires that the local branch fast-forwards the remote, otherwise refuse;
   - discard-local creates `composer-backup/<slug>-<timestamp>` holding the local commits plus a WIP commit of the dirty files, then resets to the remote;
   - non-TTY refuses.
4. Verify GREEN, then commit.

**Done when:**
- [test] with uncommitted `.docs` changes resume shows the local changes beside the saved remote progress and prompts keep-local or discard-local, keep-local with a fast-forwardable branch starts the session with the local work in place and the next checkpoint commits and pushes it, and discard-local leaves a `composer-backup/<slug>-<timestamp>` branch containing every discarded commit and a WIP commit of the dirty files while the worktree matches the remote.
- [test] keep-local with commits that diverge from the remote refuses naming the divergent commits and the backup option, and non-TTY resume with leftovers refuses naming them, each exiting non-zero with the worktree unchanged and nothing landed.

**Files likely touched:**
- `src/conductor/src/engine/engineer/resume.ts` — leftover handling
- `src/conductor/test/engine/engineer/resume-leftovers.test.ts` — new tests

**Dependencies:** Task 12

### Task 14: Ownership take-over on resume
**Story:** Story 14
**Story:** Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/resume-ownership.test.ts` (mocked owner resolution, `executeRemoteGit`, interactive approval) for every Done-when check below.
2. Verify RED.
3. In resume, when the machine owner differs from the committed `Owner:` and no `CONDUCT_DAEMON_SESSION` marker is set, prompt for take-over.
4. On yes:
   - re-stamp the marker with `writeIntakeMarker` and append `ownerHistory`;
   - commit, then push under a `GithubExplicitOperationApproval` bound to the exact `spec/<slug>` remote ref and push operation;
   - a refused approval leaves the commit unpushed and the run local-only.
5. On no, in non-TTY, or in an engine session: set the run local-only, so `compose checkpoint` commits without remote writes and prints that the run stays local until take-over.
6. Refuse before prompting when the machine owner is unresolved.
7. Verify after a take-over push that the next checkpoint passes `authorizeGithubMutation` without an approval (C1, ADR A3).
8. Verify GREEN, then commit.

**Done when:**
- [test] an accepted take-over, made without any request to the previous owner, commits `.docs/intake/<slug>.md` re-stamped to the new owner and an A-to-B `ownerHistory` entry, pushes that commit under one explicit approval bound to the exact `spec/<slug>` ref and push operation, and the following checkpoint publishes through `authorizeGithubMutation` with no further approval.
- [test] a declined take-over, a non-TTY resume (which shows no take-over prompt and makes no re-stamp) and a refused approval each leave the owner as A, make the next checkpoint commit locally with no push or PR write to that branch, and print the owner A and that the run stays local until an interactive take-over.
- [test] a resume or checkpoint in an engine-dispatched or daemon session, detected by the `CONDUCT_DAEMON_SESSION` marker that the engine sets on every dispatched and daemon session, never prompts, never re-stamps the owner, and makes no remote write to another owner's branch.
- [test] a resume whose machine owner is unresolved refuses before prompting or writing anything, naming the unresolved identity, and across the checkpoint, resume, take-over, switch and hand-off tests no issued GitHub operation edits the source issue's assignees.
- [test] `decideSpecGate` given the re-stamped marker as the merged spec's owner stamp dispatches the spec for B's daemon owner and gates it for A's daemon owner.

**Files likely touched:**
- `src/conductor/src/engine/engineer/resume.ts` — take-over flow
- `src/conductor/src/engine/engineer/checkpoint.ts` — local-only mode
- `src/conductor/test/engine/engineer/resume-ownership.test.ts` — new tests (including the `decideSpecGate` owner-stamp case)

**Dependencies:** Task 4, Task 12

### Task 15: Resume launches the chosen interactive host
**Story:** Story 7
**Story:** Story 10
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-resume-launch.test.ts` (injected `spawnHost`) for every Done-when check below.
2. Verify RED.
3. After attaching, resolve the provider (`--provider`, then the launch-host order) with `requireProviderCapability('interactiveLaunch')`. Reuse the launcher's nested-host refusal, then spawn through `spawnInteractiveHost` with the Composer skill prompt carrying the resume worktree.
4. Verify GREEN, then commit.

**Done when:**
- [test] `compose resume <PR> --provider codex` spawns the codex interactive host once with the `$composer` prompt carrying resume mode and the attached worktree path, and the resumed skill session receives the first unaccepted step.
- [test] resume from inside a Claude or Codex host session (the `CLAUDECODE` or `CODEX_THREAD_ID` marker set) prints the launcher's nested-host diagnostic and spawns nothing.
- [test] resume with an uninstalled or non-interactive provider fails closed with a diagnostic naming the provider, spawns nothing, and leaves the branch tip and run record unchanged.

**Files likely touched:**
- `src/conductor/src/engine/engineer/resume.ts` — launch
- `src/conductor/src/engine/engineer-cli.ts` — shared spawn path
- `src/conductor/test/engine/engineer/engineer-cli-resume-launch.test.ts` — new tests

**Dependencies:** Task 12

### Task 16: Launcher correlates runs and auto-saves drafts after exit
**Story:** Story 2
**Story:** Story 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-launch-boundary.test.ts` (injected `spawnHost`, mocked git and gh) for every Done-when check below.
2. Verify RED.
3. The launcher exports `AI_CONDUCTOR_COMPOSE_LAUNCH_ID` to the host. `compose worktree` and `compose resume` emit `composer_run_started` / `composer_run_resumed` with that id. After the host exits, the launcher:
   - reads each registered project's `.pipeline/composer-events.jsonl` for this id;
   - for each unfinished run, runs a `--draft` checkpoint;
   - skips runs with no `.docs` changes;
   - on a push failure, reports the draft as saved locally only, with the retry command.
4. Verify GREEN, then commit.

**Done when:**
- [test] `compose worktree` and `compose resume` run under a launcher each write one `composer_run_started` or `composer_run_resumed` event carrying `AI_CONDUCTOR_COMPOSE_LAUNCH_ID` to the target's composer event ledger.
- [test] after a launcher-started host exits with an unaccepted PRD draft, the launcher finds the run through the `composer_run_started` event carrying its launch id and runs a draft checkpoint that pushes `spec/<slug>` with the PRD step recorded as draft.
- [test] a host exit with no uncommitted `.docs` changes produces no commit and no push, and a failed draft push makes the launcher state the draft is saved locally only with the retry command before it shows the boundary choices.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — launch id, event emission, post-exit save
- `src/conductor/test/engine/engineer/engineer-cli-launch-boundary.test.ts` — new tests

**Dependencies:** Task 3, Task 4, Task 12

### Task 17: Launcher boundary choices, provider switch and hand-off
**Story:** Story 6
**Story:** Story 10
**Story:** Story 5
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-launch-boundary.test.ts` for every Done-when check below.
2. Verify RED.
3. After the auto-save, render the step and active provider and parse a `BoundaryChoice`:
   - **continue** relaunches the same provider in resume mode;
   - **switch** lists the catalog providers that declare `interactiveLaunch`, with no probe; it refuses an incapable choice and re-offers, otherwise emits `composer_provider_switched` and relaunches the chosen provider in resume mode;
   - **handoff** emits `composer_run_handed_off` and prints the PR URL and the resume command.
4. Non-TTY defaults to handoff. Once the run is handed off or delivered, the existing another-idea prompt follows. New ideas keep the host selected at launch, and a session with no run keeps the unchanged prompt.
5. Verify GREEN, then commit.

**Done when:**
- [test] after an unfinished run the launcher prints the run's current step and active provider and offers continue, switch and hand off, and continue relaunches the same provider in resume mode for that worktree.
- [test] choosing switch to codex in a launcher started with claude writes one `composer_provider_switched` event to the target's composer event ledger carrying the run slug, current step, `fromProvider` claude, `toProvider` codex and actor, and spawns the codex host with the `$composer` resume prompt for the same worktree naming the run's first unaccepted step, and a later accepted another-idea launches on claude.
- [test] choosing a provider without `interactiveLaunch` is refused naming the missing capability, and choosing an uninstalled provider fails at launch naming that provider, each offering the choices again with the branch tip and run record unchanged, and the switch list is built from the provider catalog with no provider version probe before the spawn.
- [test] hand off and a non-TTY exit each leave the run saved and its PR in draft with no `pull-request.ready`, write `composer_run_handed_off` to the target's composer event ledger, print the PR URL and the resume command, relaunch nothing, and then show the existing another-idea prompt, while a session that touched no run shows only that existing prompt unchanged.
- [test] in a project with no remote, choosing hand off is refused with an explanation that the run exists only locally, and the run stays unchanged.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — boundary prompt and relaunch
- `src/conductor/test/engine/engineer/engineer-cli-launch-boundary.test.ts` — tests

**Dependencies:** Task 2, Task 15, Task 16

### Task 18: Composer skill checkpoints each accepted step and supports resume mode
**Story:** Story 1
**Story:** Story 7
**Story:** Story 13
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/skills/composer-skill-checkpoint.test.ts` for every Done-when check below.
2. Verify RED.
3. Edit `skills/composer/SKILL.md` so that:
   - after each operator-accepted DECIDE step the skill runs `ai-conductor compose checkpoint --worktree <p> --step <step> --accept --notes-file <f>`;
   - in resume mode it starts at the first unaccepted step;
   - it presents drafts as drafts;
   - it keeps every step's clarifying questions and acceptance gate.
   The edit retires the "do not pre-push" rule only for checkpoint publication.
4. Verify GREEN, then commit.

**Done when:**
- [test] `skills/composer/SKILL.md` instructs running `ai-conductor compose checkpoint` with `--accept` after every operator-accepted DECIDE step, as asserted by the skill-text test.
- [test] the skill's resume-mode section directs starting at the first unaccepted step reported by resume without re-running any accepted step, presenting drafts as unaccepted, and keeping each remaining step's clarifying questions and operator acceptance, as asserted by the skill-text test.
- [test] the skill requires no switch, resume or hand-off action for a run that completes in one session, and its only added step in that flow is the per-step checkpoint call, as asserted by the skill-text test.

**Files likely touched:**
- `skills/composer/SKILL.md` — checkpoint and resume-mode instructions
- `src/conductor/test/skills/composer-skill-checkpoint.test.ts` — new tests

**Dependencies:** Task 3, Task 12

## Integration Points

- After Task 6: an accepted step reaches the remote with a draft PR, through `compose checkpoint`.
- After Task 8: `compose land` and `compose handoff` deliver a checkpointed run over its draft PR.
- After Task 15: `compose resume` continues a run on another machine with another provider.
- After Task 17: the launcher guides continue, switch and hand-off end to end.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D1 | task | task-18 | instructs running `ai-conductor compose checkpoint` with `--accept` after every operator-accepted DECIDE step |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D2 | task | task-1 | `recordAcceptance` writes an accepted step carrying actor, provider, acceptance time, every artifact path with its SHA-256 digest |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D3 | task | task-1, task-7 | reports the stories step as draft and every later accepted step (the plan step) as needs-reconfirm |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D4 | task | task-3, task-4 | invokes `executeRemoteGit` once with a plain push of `spec/<slug>` using the `write` credential and no `--force` or `--force-with-lease` |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D5 | task | task-5, task-6 | issues exactly one `pull-request.create` with `draft: true` and base set to the repository's default base |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D6 | task | task-12, task-13 | each fetch `origin spec/<slug>` and attach the same `.worktrees/engineer-<slug>` tracking the remote branch |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D7 | task | task-7, task-8 | refuses with `unaccepted-draft` naming the artifact |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D8 | task | task-16, task-17 | offers continue, switch and hand off, and continue relaunches the same provider in resume mode for that worktree |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D9 | task | task-9, task-10 | heals to `done` with `prUrl` set to that URL |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D10 | task | task-2 | each of the five `composer_*` kinds is a member of the `ConductorEvent` union and has an `EVENT_SINKS` entry |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D11 | task | task-14 | pushes that commit under one explicit approval bound to the exact `spec/<slug>` ref and push operation |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D12 | no-change | none | Delivery split decision: this plan implements none of the review-comment resolution, which the follow-up spec blocked by #2050 owns |
| adr-2026-11-07-composer-run-checkpoint-resume-handoff#D13 | no-change | none | Retains ADR-008 unchanged; resume launches the interactive host through the existing launcher spawn path and adds no authoring subprocess |
| adr-2026-07-03-pr-timing-config-key#D1 | no-change | none | Amended 2026-11-07: the never-implemented `pr_timing` key no longer governs the Composer flow, and this feature adds no config key |
| adr-2026-07-03-pr-timing-config-key#D2 | no-change | none | No `pr_timing` validation is added because no key is introduced |
| adr-2026-07-03-pr-timing-config-key#D3 | no-change | none | No `resolvePrTiming` resolver is added; Composer checkpointing is unconditional per the amendment |
| adr-2026-07-03-pr-timing-config-key#D4 | no-change | none | Early-draft semantics apply only to the unbuilt daemon-flow key; the daemon build flow is unchanged here |
| adr-2026-07-03-pr-timing-config-key#D5 | no-change | none | Lazy PR creation for the daemon flow is unchanged; the Composer draft PR is governed by the new ADR's D5 |
| adr-2026-07-03-pr-timing-config-key#D6 | no-change | none | Composer publishes route through the guarded boundary of adr-2026-09-11-github-operation-ownership D1 and D5, not a new `pushBranch` primitive |
| adr-2026-07-03-pr-timing-config-key#D7 | no-change | none | Daemon discovery still reads only base-branch `.docs/plans` (`daemon-backlog.ts`), so pushed spec drafts stay invisible to it |
| adr-2026-07-03-engineer-checkpoint-commits-idempotent-land#D1 | task | task-3, task-4 | commits the step's `.docs` artifacts plus `.docs/composer-runs/<slug>.json` |
| adr-2026-07-03-engineer-checkpoint-commits-idempotent-land#D2 | existing | none | `landSpec` already commits only when the `.docs` stage is non-empty (`land-spec.ts` commit step guarded by `git diff --cached --quiet`) |
| adr-2026-07-03-engineer-checkpoint-commits-idempotent-land#D3 | task | task-8 | then `pull-request.ready`, and no `pull-request.create` |
| adr-2026-07-03-engineer-checkpoint-commits-idempotent-land#D4 | existing | none | Handoff's remove-on-success and keep-on-failure worktree lifecycle (`engineer-cli.ts` handoff case) is unchanged |
| adr-2026-09-11-github-operation-ownership#D1 | task | task-4 | invokes `executeRemoteGit` once with a plain push of `spec/<slug>` |
| adr-2026-09-11-github-operation-ownership#D2 | task | task-14 | make the next checkpoint commit locally with no push or PR write to that branch |
| adr-2026-09-11-github-operation-ownership#D3 | task | task-3 | refuses before writing any marker, commit or push when the machine owner is unresolved |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | No shared-resource mutation such as label definitions is added |
| adr-2026-09-11-github-operation-ownership#D5 | task | task-4 | a non-fast-forward rejection leaves the remote ref unchanged, keeps the local commit, exits non-zero |
| adr-2026-09-11-github-operation-ownership#D6 | task | task-4 | reports the step as not saved remotely |
| adr-2026-09-11-github-operation-ownership#D7 | existing | none | Every GitHub operation used (`pull-request.create`, `pull-request.edit`, `pull-request.ready`, `ambient.graphql.read`) is already in the operation registry (`github-operations.ts`) |
| adr-2026-09-11-github-operation-ownership#D8 | no-change | none | No owner-gated label or comment is written to a foreign resource |
| adr-2026-09-11-github-operation-ownership#D9 | task | task-4 | using the `write` credential |
| adr-2026-09-11-github-operation-ownership#D10 | no-change | none | Applies to daemon commit co-authorship; Composer checkpoint commits are operator-session commits and add no daemon commit path |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-refusal-64449b95-c15a-495f-a1e3-bbe241a13806: Delete docs/reports/composer-build-evidence-review/report.html (and the now-empty directory); add nothing in its place
**Gate:** prd-audit
**Rationale:** Removal only, per the operator's refusal decision. Delete the refused, non-plan, stale HTML evidence report. This introduces no new behavior, and nothing references the file.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision 64449b95-c15a-495f-a1e3-bbe241a13806 r2)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision 64449b95-c15a-495f-a1e3-bbe241a13806 r2) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-64449b95-c15a-495f-a1e3-bbe241a13806 is committed and its targeted tests pass.
