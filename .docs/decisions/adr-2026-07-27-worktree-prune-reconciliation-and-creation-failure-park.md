# ADR: Prune-at-the-seam worktree reconciliation, and an auto-park for pre-worktree creation failures

Status: APPROVED

Date: 2026-07-27
Issue: jstoup111/ai-conductor#1022
Related: #681 (resume path re-kicks git errors with no backoff), #497 (lost `.pipeline/` state)

## Context

Removing a worktree directory without deregistering it (`rm -rf .worktrees/<slug>`) leaves
the worktree **registered**. `git worktree list --porcelain` reports the record with a
`prunable` sibling line, and every subsequent `git worktree add` for that path exits **128**
until `git worktree prune` runs. Verified end to end in a throwaway repository.

Two engine behaviors turn that into a silent, restart-surviving loop:

1. `isRegisteredWorktree` (`worktree-shared.ts:86-102`) filters porcelain **line-wise** on the
   `worktree ` prefix and never inspects the sibling `prunable` line, so `ensureWorktree`
   returns `'reused'` for a path that does not exist on disk.
2. `createWorktree` throws at `daemon-runner.ts:311`, before `worktree` is assigned. The catch
   at `:535` is guarded by `if (worktree)`, so `writeErrorHalt` never runs and **nothing is
   recorded anywhere**.

The consequence is a hot spin. On the error outcome `daemon.ts:853-866` adds the slug to the
**in-memory** `parked` set; the next `pickEligible` calls `isHalted(slug)` →
`exists(<worktree>/.pipeline/HALT)` → false (there is no worktree) → the slug falls through as
eligible and is immediately re-dispatched with no backoff. A daemon restart clears even the
in-memory set, so there is no evidence trail at all.

This repository already documents both the symptom and the remedy in prose — CLAUDE.md's
Daemon Operations Safety rule 2 and `docs/runbooks/worktree-and-evidence-recovery.md`, whose
"Symptom" list quotes this exact `fatal:` string. Per the repo's Design Principle, prose that
describes a mechanically-detectable, mechanically-fixable condition is the wrong enforcement
layer.

## Decision 1 — Detect prunable per-record, and reconcile with `git worktree prune` at the point of use

`isRegisteredWorktree` parses `git worktree list --porcelain` into blank-line-separated
**records** rather than filtering lines, and treats a record carrying a `prunable` line as
**not a usable registration**. When such a record is observed for the requested path,
`ensureWorktree` runs `git worktree prune` in `root` before proceeding to attach or create.

Pruning is **not** unconditional: it fires only when a prunable record for the requested path
was actually observed, so a healthy repository's git call sequence is unchanged.

### Alternatives rejected

- **`git worktree add -f`.** Verified to work, but it masks the stale registration inside
  git's metadata rather than reconciling it, and it would equally happily stomp a registration
  that is stale for a reason we have not diagnosed. `prune` is narrower and self-describing.
- **Filtering prunable without pruning.** Insufficient, and verified so: with the entry
  filtered out, `ensureWorktree` falls through to the attach path and
  `git worktree add <path> <branch>` **also** exits 128 against the surviving registration.
  The two halves of this decision are not separable.
- **Prune unconditionally at daemon startup.** A repo-global side effect at a distance that
  hides the per-feature failure and does nothing for a registration that goes stale mid-run.

## Decision 2 — A creation failure that precedes the worktree writes a durable auto-park, not a HALT

When `createWorktree` throws and `worktree` is still `null`, the daemon writes
`writeAutoPark(projectRoot, slug, reason)` — a durable `.daemon/parked/<slug>` marker carrying
the underlying git error (including the 128 cause) and the prune remedy.

The decisive property is **dispatch gating**. `pickEligible` consults `isParked` **first and
unconditionally** (`daemon.ts:136`), before the in-memory `parked`/`started` sets are reached.
`isHalted` is a later, conditional check whose production wiring resolves a worktree-relative
path (`daemon-deps.ts:265`) — so for a feature with no worktree it can only ever return false.
A HALT therefore could not gate dispatch here even if it could be written. `.daemon/parked/<slug>`
is the only durable surface in the primary checkout that both survives a daemon restart and
gates dispatch, and `writeAutoPark` already resolves to the main repo root even when called
from a worktree (`resolveMainRepoRoot`, `park-marker.ts:50`), which is what makes it writable
when no feature worktree exists.

Secondarily — and true of today's layout specifically — `.pipeline/HALT`, the remedy the issue
proposed, is also **structurally unavailable**: it lives inside the worktree, and the worktree
is what failed to come into existence. This argument is deliberately *not* load-bearing. Open
PR #770 (`adr-2026-07-21-run-state-home-dir-placement`, APPROVED, unmerged) would relocate
run-state to `~/.ai-conductor/runs/<project-key>/<slug>/`, addressed by feature identity rather
than cwd, making a HALT writable without a worktree. The gating argument above holds under
either merge order; see `.docs/conflicts/2026-07-27-removed-but-registered-worktree-1022.md`
overlap 1.

Note also that the gate wired at `daemon-cli.ts:1360` is `isOperatorParked`, which despite its
name is provenance-**agnostic** — it tests only for the existence of
`parkedMarkerPath(mainRoot, slug)` (`park-marker.ts:158-176`). `writeAutoPark` writes to that
same path, so the auto-park is honored by the gate. Verified against source, not assumed.
Because `writeAutoPark` uses an exclusive create (`wx`) and treats `EEXIST` as a no-op, this
park can never clobber a pre-existing operator park.

The park is written through `writeAutoPark` specifically so the `auto-parked:` body prefix
preserves provenance for `getProvenanceType` (`park-marker.ts:265`); it is cleared by the
existing `conduct daemon unpark <slug>`.

This layer is deliberately broader than the prunable case: **any** worktree-creation failure
now parks with evidence. Decisions 1 and 2 are defence in depth — 1 removes the known cause,
2 guarantees an unknown cause cannot spin silently.

### Alternatives rejected

- **Retry with backoff around `createWorktree`.** Treats a deterministic, permanently
  reproducing condition as transient. It would slow the spin without resolving it or leaving
  evidence.
- **Reusing `.daemon/warned/<slug>`.** One-shot log dedup; does not gate dispatch.
- **Reusing `.daemon/gated.json`.** Rewritten wholesale on every discovery pass, so a failure
  record would be erased on the next poll.
- **Auto-clearing the park once the condition resolves.** Rejected: a silent self-unpark
  reintroduces an unobserved retry loop, which is the class of bug this ADR closes. Clearing
  stays an explicit operator action.

## Consequences

1. A removed-but-registered worktree is reconciled automatically on the next dispatch; the
   operator no longer has to run `git worktree prune` by hand. The runbook moves this case
   from a manual recovery step to a documented automatic behavior.
2. A worktree-creation failure the engine cannot reconcile stops the feature durably and
   visibly instead of spinning. Recovery becomes: read `.daemon/parked/<slug>`, fix the cause,
   `conduct daemon unpark <slug>`.
3. A new auto-park reason exists that operators will encounter; it must be documented in
   `docs/guides/running-the-daemon.md` alongside the existing auto-park reasons.
4. The engineer path (`worktree-authoring.ts:82`) inherits the fix. Its current failure mode —
   a bare `ENOENT` from running `git status` in a nonexistent cwd — becomes its documented FR-7
   strict-abort message.
5. `isRegisteredWorktree` gains a real parser. Its porcelain-record handling is now
   load-bearing and must be pinned by a fixture matching real git output.
