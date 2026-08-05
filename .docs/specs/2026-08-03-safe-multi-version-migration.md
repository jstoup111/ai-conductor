# PRD: Safe multi-version harness migration

**Date:** 2026-08-03
**Status:** Approved
**Source:** `jstoup111/ai-conductor#219`

## Problem / Background

Consumers pinned to the 0.99.17-era will jump many releases straight to 1.0.0 in a single update.
That jump replays every `## Migration` block queued in the range through `bin/migrate`, a runner
that has never had a single test written against it. Direct inspection of the current repository
established the following, all verified by reading the code and the changelog:

- The whole queued set is 19 ```` ```bash migration ```` fences under one `## Migration` section
  inside the already-tagged `## [0.99.20]` entry. The originating issue described them as sitting
  in `[Unreleased]`; the 0.99.20 release folded them into the version entry, and `[Unreleased]` is
  now empty. The multi-block risk is unchanged — it simply lives one section lower.
- Two of those blocks have a bare, working-directory-relative `./bin/install` as their **final**
  command. Blocks execute with the consumer project as the working directory, where no
  `./bin/install` exists, so the block exits non-zero, the runner aborts the sequence, and the
  caller rolls the consumer's harness checkout back. The update cannot succeed.
- Blocks run through `bash -c` with no fail-fast semantics, so a block whose failure is not its
  last command reports success. One such block force-removes every Git worktree in the consumer's
  repository after an earlier `cd` fails, then exits zero — the exact destructive outcome the
  repository's own daemon-safety rules were written to prevent. Another restarts a running daemon
  without operator action.
- Nothing records which blocks have already run. Idempotency is delegated entirely to each block's
  own prose guards, and at least one block's guard cannot match what it writes, so it appends to
  the consumer's config on every single run.
- Declining the approval prompt, or running without a terminal, returns success. The caller then
  advances the recorded installed version past the range, so the declined blocks fall out of every
  future range permanently and can never be replayed.
- On the `main` channel the recorded version is `main@<sha>`, which the range parser cannot read.
  Both bounds collapse and the runner offers every migration block in changelog history on every
  update.

The opportunity is to make the 0.99.17 → 1.0.0 jump — and every jump after it — provably ordered,
idempotent, fail-loud, and safe to decline, and to give the runner the test coverage it has never
had.

## Goals & Non-Goals

**Goals**

- Make repeated migration runs safe by recording what has already been applied, rather than
  trusting each block's hand-written guard.
- Make block execution fail loudly and stop the sequence, so a broken block is never mistaken for
  an applied one.
- Give the operator per-block approval, and make declining safe rather than permanently lossy.
- Correct the already-queued 0.99.20 blocks so the v1.0 update succeeds for a real consumer.
- Prevent a future migration block from reintroducing the same classes of defect.

**Non-Goals**

- Redesigning the update channels, the release PR workflow, or how `CHANGELOG.md` is rendered.
- Removing the duplicated update logic still resident in `bin/conduct` — that is issue #226's work.
- Automatically undoing side effects of a migration block that already ran.
- Rewriting migration blocks belonging to releases outside the corrected 0.99.20 entry.
- Adding any new external dependency, network call, or service to the update path.

## Users / Personas

- **Updating consumer:** runs an update from a long-stale pin and expects the harness to reach the
  new version with its project intact.
- **Cautious operator:** wants to read each migration command and decide on it individually,
  including declining one without forfeiting the rest.
- **Unattended consumer:** updates from a script or a non-interactive session and must never have
  migrations silently skipped-and-forgotten or silently executed.
- **Harness maintainer:** authors new migration blocks and needs the contract enforced at review
  time rather than discovered by a consumer.

## Functional Requirements

- **FR-1:** The runner records each migration block it executes in durable per-consumer state,
  keyed by an identity that stays stable when the changelog is re-rendered.
- **FR-2:** A block already recorded as applied is neither offered nor executed again.
- **FR-3:** The candidate set is derived from the applied-block record rather than from the
  installed-version string alone, so an unparsable or channel-specific version identity can neither
  widen nor collapse the range.
- **FR-4:** Blocks are executed in a deterministic order: ascending release version, then document
  order within a release.
- **FR-5:** Each block executes under fail-fast shell semantics, so any failing command inside a
  block fails that block.
- **FR-6:** A failing block stops the sequence and is reported with its release and position, and
  every block applied before it stays recorded as applied.
- **FR-7:** The operator approves blocks individually, with the ability to accept one, skip one,
  accept all remaining, or stop.
- **FR-8:** A skipped, declined, or unreached block is recorded as pending rather than applied, and
  is offered again on the next run.
- **FR-9:** When no approval channel exists, the runner executes nothing, advances no state that
  would make pending blocks unreachable, and reports how to run them.
- **FR-10:** Blocks execute with the harness location available to them, so a block can address
  harness-owned files without depending on the consumer's working directory.
- **FR-11:** Every `## Migration` section within a release entry contributes its blocks, not only
  the first one found.
- **FR-12:** The runner reports a closing summary distinguishing applied, skipped, failed, and
  already-applied blocks.
- **FR-13:** The queued 0.99.20 blocks are corrected so that none depends on a consumer-relative
  harness path, none performs a destructive repository operation, none restarts a daemon without
  operator action, and each is idempotent when executed repeatedly.
- **FR-14:** A repository check rejects a newly authored migration block that violates the block
  authoring contract.

## Non-Functional Requirements

- No new runtime dependency: the runner stays a Bash script with an embedded Python parser.
- The applied-block record is human-readable and hand-repairable.
- Behavior is identical on the tagged and main update channels.
- All new tests run offline against scratch fixtures with an isolated home directory, and make no
  real network, provider, or daemon calls.
- Correcting the queued blocks changes only the frozen `## [0.99.20]` entry's block bodies; no
  release metadata, version, or unreleased section is rewritten.

## Acceptance Criteria / Success Metrics

- A scratch consumer pinned at v0.99.17 completes the jump to the cutover release with every
  corrected block applied, in order, and the project's worktrees, config, and daemon state intact.
- Re-running the same migration immediately afterward applies nothing and reports every block as
  already applied.
- A deliberately failing block halts the sequence, is named in the failure report, and leaves the
  blocks before it recorded as applied and the blocks after it pending.
- Declining a block and re-running offers exactly that block again.
- A non-interactive run executes nothing and leaves every pending block reachable by a later run.
- A `main`-channel run offers the same block set as the equivalent tagged run.
- A migration block authored with a consumer-relative harness path is rejected by the repository
  check.

## Open Questions

- None blocking. The disposition for correcting the frozen `## [0.99.20]` block bodies is recorded
  in the ADR and is granted by the operator merging this spec.
