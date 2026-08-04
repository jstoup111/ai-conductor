# ADR: Ledgered, per-block migration execution

**Date:** 2026-08-03
**Status:** APPROVED
**Feature:** `verify-bin-migrate-handles-a-multi-version-jump-wi` (`jstoup111/ai-conductor#219`)
**Related:** #226 (removal of `bin/conduct`'s duplicated update block), #228 (v1.0 cutover umbrella)

## Context

`bin/migrate` decides what to run purely from a version range: the installed version read from
`~/.claude/ai-conductor.config.json` and the target version read from the checked-out tag or the
`VERSION` file. It executes the resulting blocks as one approved batch and records nothing. Every
defect verified in this investigation traces back to that single design choice.

Verified against the current tree:

1. The range collapses whenever the installed-version identity is not plain semver. On the `main`
   channel it is `main@<sha>`, which the parser cannot read, so both bounds vanish and the entire
   changelog history becomes applicable on every update (`bin/migrate:121-130`, `:157-160`).
2. Declining the batch, or having no terminal, returns success (`bin/migrate:204-215`). The caller
   then advances `currentVersion` (`bin/update:110-123`), so the declined blocks leave the range
   forever. There is no state that could bring them back.
3. Blocks run through `bash -c` with no fail-fast (`bin/migrate:225`, `:239`), so only a block's
   last command determines its exit status. A block that force-removes every Git worktree in the
   consumer repository after an earlier `cd` fails still exits zero.
4. Idempotency is delegated to each block's own guard. At least one queued block guards on
   `^attribution_judge_cutover:` while appending a commented-out form of that key, so its guard can
   never match what it writes and it appends on every run.
5. Only the first `## Migration` section per release entry is read, because the parser uses a
   single search rather than iterating (`bin/migrate:166`).
6. Nothing tests any of this. `test/test_bin_update.sh` stubs `bin/migrate` out and states its
   behavior is out of scope; no other test exercises it.

## Decision

### 1. A durable applied-block ledger is the authority for what runs

Introduce a per-consumer-project ledger recording every migration block whose execution completed
successfully. Block identity is the release label plus a content hash of the block body, so it
survives changelog re-rendering and does not depend on a fence's ordinal position.

The candidate set becomes *parsed blocks minus applied blocks*, ordered by ascending release then
document order. The version range is retained only as advisory display context.

**Consequences.** Repeated runs are structurally idempotent regardless of what an individual block
does. The `main` channel behaves identically to the tagged channel, because a collapsed range no
longer implies re-execution. Declining is no longer lossy. A first-ever run on a consumer with no
ledger is bounded by the version range as today, so existing installations do not suddenly replay
their entire history.

**Rejected alternative — keep the version range authoritative and just fix the parser.** It cannot
fix declining or the non-interactive skip, because after either one the recorded version has moved
past blocks that never ran. The information needed to replay them does not exist anywhere.

### 2. One block per invocation, under fail-fast semantics, with the harness location exported

Each approved block runs in its own shell started with `set -euo pipefail` and with `HARNESS_DIR`
exported into its environment. A non-zero result fails that block, stops the sequence, and leaves
it and everything after it pending.

**Consequences.** Silent no-op blocks become loud failures. A block can address harness-owned files
without a working-directory-relative path. The working directory stays the consumer project, so
project-relative paths in existing blocks keep working.

**Rejected alternative — run each block from the harness directory.** It would fix the relative
`./bin/install` calls but break every block that reads `.ai-conductor/config.yml`, `.gitignore`, or
`.daemon/` from the consumer project, which is the large majority.

### 3. Approval is per block, and declining is recorded as pending

Replace the single batch prompt with a per-block preview offering accept, skip, accept-all, and
stop. Skipped and unreached blocks are recorded as pending. With no approval channel available,
nothing executes, nothing is recorded as applied, and the runner reports how to run the pending set
later.

**Consequences.** An operator can reject one questionable block without forfeiting the other
eighteen. The non-interactive path becomes safe by construction rather than by the caller's
restraint: even though `bin/update` still advances `currentVersion` afterward, the ledger keeps the
pending blocks reachable.

**Rejected alternative — make `bin/update` withhold the version advance when migrations were
skipped.** It leaves the consumer permanently detected as out of date and re-prompting on every
invocation, and it still loses blocks in the failure case.

### 4. The queued 0.99.20 block bodies are corrected in place, as a one-time exemption

Four of the nineteen queued blocks cannot be rescued by runner hardening alone. Two would abort the
update on a relative `./bin/install`; one force-removes the consumer's worktrees; one restarts a
running daemon unattended; one appends to consumer config on every run. Their bodies are corrected
directly in the frozen `## [0.99.20]` entry.

This is a deliberate, bounded exemption from the repository rule that implementation branches never
write `CHANGELOG.md`. It is safe from clobbering because the release PR renderer only collects
candidates since the latest tag and `v0.99.20` is already tagged, so that entry is never
regenerated. The exemption covers block bodies inside that one frozen entry only; no release
metadata, `VERSION`, or `[Unreleased]` content is touched. **The operator grants this exemption by
merging the spec PR; the implementation branch must not widen it.**

**Rejected alternative — a harness-owned overrides file that supersedes broken blocks by content
hash.** It preserves the changelog rule perfectly, but it creates a second source of truth for
migration content that every future reader and every future tool must consult. The cost is
permanent; the exemption's cost is one bounded diff.

### 5. The block authoring contract is enforced by a repository check

Add an integrity check that rejects a migration block which invokes a harness binary by a
working-directory-relative path, performs a destructive repository operation such as a forced
worktree or branch removal, or restarts a daemon without operator action.

**Consequences.** The defect classes found here cannot be reintroduced by a future PR. The check is
deliberately narrow and pattern-based; it is a backstop for known-bad shapes, not a general safety
proof.

## Out of scope

- Removing the duplicated update logic in `bin/conduct` (#226). It calls the same `bin/migrate` and
  inherits this fix unchanged.
- The mangled `## [0.3.0]` heading at `CHANGELOG.md:907`, which splices authoring guidance into a
  version heading and produces a duplicate `0.3.0` section. It is real, it is recorded here, and it
  is harmless to this feature because that section carries no runnable fence. It deserves its own
  intake issue.
- The dead `### Migration` blocks under both `## [Unversioned]` sections, which no version-range
  parse can ever reach.
- Undoing side effects of blocks that already ran before this change shipped.

## Verify-Claims Ledger

### Claims

- [verified, 100%] The queued set is 19 fences under a single `## Migration` at `CHANGELOG.md:76`
  inside the tagged `## [0.99.20]` entry; `[Unreleased]` is empty. Read directly from the file.
- [verified, 100%] Two queued blocks end in a bare `./bin/install`, and blocks execute with the
  consumer project as the working directory (`bin/migrate:108-110`, `:177-181`, `:225`).
- [verified, 100%] `bash -c` is used with no fail-fast, so a block's status is its last command's.
- [verified, 100%] Declining or lacking a TTY returns 0, after which `bin/update:114` advances
  `currentVersion`.
- [verified, 100%] `main@<sha>` fails `norm()` and collapses the lower bound.
- [verified, 100%] No test anywhere exercises `bin/migrate`; `test/test_bin_update.sh:12-13,59-72`
  stubs it and says so.
- [verified, 95%] The release PR renderer collects candidates only since the latest tag, so the
  tagged `0.99.20` entry will not be regenerated over a hand correction. Basis: the workflow's
  stated contract and commit `d7756f0d5`. Residual risk is a future change to that collection
  window, which would be caught by the release PR's own audit diff.

### Assumptions

- **Consumer projects do not contain `./bin/install`.** Confidence 98%, inferred from the runner's
  own `in_harness_repo` guard existing precisely to distinguish the two cases. Impact if wrong: two
  of the four block corrections become unnecessary but remain harmless. Confirmed by the scratch
  consumer fixture the plan builds, which will fail loudly if the path resolves.
- **`~/.ai-conductor/` is an acceptable home for per-project ledger state.** Confidence 90%,
  inferred from the existing canonical memory store at `~/.ai-conductor/memory/` and the build-auth
  token at `~/.ai-conductor/build-auth`. Impact if wrong: the ledger path moves, which is a
  one-line change isolated to the ledger reader and writer. The plan's first task pins the location
  so the choice is settled before anything depends on it.

Verdict: CLEAR — no unconfirmed load-bearing assumption remains.
