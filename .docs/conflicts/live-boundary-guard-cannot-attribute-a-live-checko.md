# Conflict Check: Kernel-enforced live-checkout containment (#1301)

**Date:** 2026-08-17
**Inventory:** every in-flight daemon worktree under `.worktrees/` (20, excluding this spec's own);
all 12 open pull requests; every local `feat/`, `fix/`, and `hotfix/` branch whose diff against
`origin/main` touches `src/conductor/src/engine/self-host/`; the approved ADR corpus for the
self-host, write-fence, and fail-closed families.
**Result:** **PASS — zero blocking conflicts.** One superseded-precedent item and one shared-file
churn item are recorded and resolved. No degrading conflict is accepted.

## Scan method

The change touches a narrow, enumerable surface, so the scan was exhaustive over that surface
rather than sampled.

| File this change touches | In-flight worktree touching it | Open PR touching it |
|---|---|---|
| `src/conductor/src/engine/self-host/live-containment.ts` (new) | none | none |
| `src/conductor/src/engine/self-host/live-boundary.ts` | none | none |
| `src/conductor/src/engine/self-host/write-fence.ts` (read only, unmodified) | none | none |
| `src/conductor/src/engine/conductor.ts` (`prepareCandidateSelfHost`) | none | none |
| `src/conductor/src/engine/resolved-config.ts` (`ResolvedSelfHostConfig`) | none | none |
| `docs/reference/configuration.md` | none | none |
| `docs/guides/running-the-daemon.md` | none | none |
| `docs/runbooks/stalled-or-stuck-feature.md` | none | none |
| `CLAUDE.md` (Daemon Operations Safety) | none | none |

Verified mechanically: for each of the 20 in-flight worktrees, `git diff --name-only
origin/main...HEAD` was filtered for `self-host/`, `live-boundary`, and `write-fence`. Every one
returned empty. The self-host provisioning lane is currently unoccupied.

Open PRs #1674, #1673, #1672, #1581, #1578, #1575, #1572, #1565, #1539, #1534, #1532, and #1168
were each checked against that list; none touches any of these files. #1672 is the bot-owned
release PR and is excluded by construction — this branch writes neither `VERSION` nor
`CHANGELOG.md`.

## Resolved: fourteen stale local branches in this lane are already-squashed history, not rivals

**Files:** `self-host/live-boundary.ts`, `self-host/sandbox-build-env.ts`,
`self-host/provider-home.ts`, `self-host/write-fence.ts`
**Type:** false positive
**Severity:** none
**Confidence:** 97%

Fourteen local branches report as unmerged by `git merge-base --is-ancestor` while touching this
lane — including `hotfix/ignore-node-modules-live-boundary`,
`fix/live-boundary-volatile-exclusions-976`, and
`feat/daemon-live-boundary-halts-self-host-builds-when-the-oper`. Each is a squash-merge remnant:
the ancestry test fails because squash merges rewrite the commit, not because the work is
outstanding. Confirmed by reading `origin/main`'s `live-boundary.ts`, which already carries every
one of their changes — the `node_modules` directory-basename exclusion (`:61`), the marketplace
and provider-state exclusions (`:113-168`), and `classifyLiveCheckoutDiff` itself (`:292-313`).
No rebase or coordination is owed.

## Resolved: `adr-2026-07-08` is refined by this change, not contradicted by it

**Stories involved:** Story 3 (both providers wrapped at one seam), Story 5 (unproven containment
still halts)
**Files:** `.docs/decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` vs
`.docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md`
**Type:** precedent
**Severity:** non-blocking (resolved by design, not deferred)
**Confidence:** 95%

`adr-2026-07-08` decides that the write fence's Bash guarding is heuristic and that the fence is
deliberately the second layer, never load-bearing. A design that amnestied a live-checkout path
because "the fence would have denied it" — the issue's own hypothesis 3 — would contradict that
decision outright, and was rejected for exactly this reason during architecture review.

The chosen design does not contradict it. Containment enforces the fence's *existing policy*
("block every write under the harness root outside the build worktree", `write-fence.ts:253-266`)
at the syscall rather than at a hook. The fence's heuristic remains non-load-bearing; the
attribution verdict derives from a two-sided kernel probe, not from the fence. That ADR's
follow-up action "extend the fence to consumer-repo daemon builds" is untouched and remains open.

The one genuine tension is that `adr-2026-07-08`'s Phase 1 leak-triage-and-auto-heal exists to
repair leaks that reach the main checkout. Under containment those leaks stop occurring on the
self-host path, so the heal path will fire less often. It is **not** removed or weakened here:
it still covers uncontained dispatches, consumer-repo builds, and any writer that is not a
self-host dispatch child.

## Resolved: `conductor.ts` and `resolved-config.ts` are high-churn shared files

**Files:** `src/conductor/src/engine/conductor.ts`,
`src/conductor/src/engine/resolved-config.ts`
**Type:** overlap
**Severity:** non-blocking
**Confidence:** 90%

Roughly 40 local branches touch `conductor.ts` and a dozen touch `resolved-config.ts`. This is
ambient churn in two files nearly every feature edits, not contention over shared semantics: no
in-flight worktree touches `prepareCandidateSelfHost` or `ResolvedSelfHostConfig`.

The edit shapes are additive and localized — one wrap call applied to an existing return value in
each of two adjacent branches, and one field appended to a resolved-config interface following the
established `sandbox_build_env` pattern. Textual rebase conflicts are possible; semantic conflicts
are not. No sequencing constraint is imposed.

## No oscillation risk

The pair that could oscillate — "the guard must halt on unattributable drift" (existing,
fail-closed) and "an operator edit must not halt the build" (#1301) — is resolved rather than
balanced. Containment removes the case where both apply simultaneously: a contained dispatch's
live-checkout drift is not unattributable, so the first requirement is not engaged. Where
containment is unproven, the first requirement governs unconditionally and the second is not
satisfied — deliberately, and stated as such in Story 5. Neither requirement is weakened to
accommodate the other, so there is no configuration in which they can send work round a loop.
