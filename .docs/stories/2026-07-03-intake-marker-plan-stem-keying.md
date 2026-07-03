**Status:** Accepted

# Stories: intake-marker plan-stem keying (fix ai-conductor#207)

Track: technical — acceptance criteria live here (no PRD). Tier: S.

Context: the daemon keys every per-spec read (owner stamp, complexity, intake Source-Ref)
by the **plan stem** — `basename(<.docs/plans/file>, '.md')`. The interactive
`engineer land` flow writes the intake marker under `slugify(idea)` instead, so when the
DECIDE flow names the plan differently from the raw idea title (the normal case), the
owner-gate reads the spec as un-owned and the issue auto-close flow loses its Source-Ref.

## Story 1: `engineer land` keys the intake marker by the landed plan stem

As the harness operator, I want `engineer land` to write `.docs/intake/<plan-stem>.md`
(not `.docs/intake/<idea-slug>.md`) so that the daemon's owner-gate and issue auto-close
find the marker for every spec landed through the interactive engineer flow.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose landed plan is `.docs/plans/2026-07-03-some-feature.md` and an
  idea whose `slugify(idea)` differs from that stem, when `engineer land` runs with
  `--source-ref owner/repo#N`, then the committed marker is
  `.docs/intake/2026-07-03-some-feature.md` containing `Source-Ref: owner/repo#N` and the
  resolved `Owner:` stamp, and no `.docs/intake/<idea-slug>.md` file is created.
- Given an idea with no `--source-ref` (chat/CLI origin) and a resolvable owner identity,
  when `engineer land` runs, then the marker is still written under the plan stem with the
  `Owner:` stamp (owner-gate coverage does not depend on GitHub intake).
- Given a pre-existing marker under the plan stem carrying a `Source-Ref:`, when land
  re-runs (retry after a prior failure), then the existing `Source-Ref` is preserved, not
  clobbered (current `writeIntakeMarker` preservation behavior is retained under the new key).

#### Negative Paths
- Given a worktree with **no** `.docs/plans/*.md` file, when `engineer land` runs, then it
  fails with a non-zero exit and an error naming the missing plan artifact, and **no**
  intake marker is written under any name (no silent fallback to the idea slug).
- Given a worktree containing an unrelated older plan `.docs/plans/other-idea.md` alongside
  this idea's plan `.docs/plans/2026-07-03-some-feature.md`, when `engineer land` runs, then
  the marker is keyed to the plan file land itself resolves and commits for this idea —
  `2026-07-03-some-feature` — and `other-idea.md` gains no marker.

### Done When
- [ ] `landSpec` derives the marker slug from the resolved plan file's stem; the
      `slugify(idea)` value is no longer used for the intake-marker filename (it remains
      valid for branch/worktree naming).
- [ ] A regression test in `test/engine/engineer/land-spec.test.ts` lands a spec whose plan
      stem ≠ `slugify(idea)` and asserts the marker path equals the plan stem, with
      `Source-Ref:` and `Owner:` intact.
- [ ] A negative test asserts land with no plan artifact exits non-zero and leaves
      `.docs/intake/` unchanged.

## Story 2: one shared plan-stem derivation used by writer and readers

As a harness maintainer, I want a single `planStem()` helper to be the only place the
marker-key rule is expressed so that the write side (`land-spec.ts`, `conductor.ts`) and
the read side (`daemon-backlog.ts`) cannot drift apart again.

### Acceptance Criteria

#### Happy Path
- Given the shared helper, when `land-spec.ts` writes a marker, `conductor.ts` stamps a
  marker post-plan, and `daemon-backlog.ts` derives the backlog slug, then all three call
  the same exported `planStem(planFilePath)` function and produce identical stems for the
  same plan path.

#### Negative Paths
- Given a plan filename containing interior dots (e.g. `.docs/plans/phase-9.3b-intake.md`),
  when each of the three call sites derives the stem, then all yield the identical stem
  `phase-9.3b-intake` (only the trailing `.md` is stripped) — verified by a shared unit
  test so a future reimplementation at one site cannot silently disagree.

### Done When
- [ ] An exported `planStem()` helper exists in one module; `land-spec.ts`,
      `conductor.ts` (post-plan stamping), and `daemon-backlog.ts` (backlog slug) all
      import it; `grep` shows no remaining inline `basename(file, '.md')` marker-key
      derivations at those three sites.
- [ ] A unit test covers `planStem()` including the interior-dot case.

## Story 3: end-to-end — a land-authored spec is owned and auto-closable at the daemon

As the repo owner, I want a spec landed via the interactive engineer flow to pass the
owner-gate and carry its Source-Ref into the daemon backlog so that post-cutover builds
dispatch and the originating issue auto-closes on implementation merge.

### Acceptance Criteria

#### Happy Path
- Given a spec landed by `engineer land` with `--source-ref owner/repo#N` and an
  `Owner:` stamp, merged to the base branch after `owner_gate_cutover`, when the daemon
  discovers its backlog, then `readSpecOwnerStamp` returns the owner (spec is NOT skipped
  as un-owned) and the backlog item carries `sourceRef: owner/repo#N` (so the
  implementation PR receives `Closes owner/repo#N`).

#### Negative Paths
- Given a **legacy** marker committed under a mismatched idea slug (pre-fix history), when
  the daemon discovers the backlog, then the spec still reads as un-owned and is skipped
  with the existing owner-gate skip reason — approach A deliberately adds **no**
  reader-side fallback scan; legacy markers are healed by manual rename (the #206/#248
  pattern), and the test pins this scope so a fallback isn't accidentally introduced.

### Done When
- [ ] An integration-level test (daemon-backlog or intake acceptance suite) exercises a
      land-authored spec with plan stem ≠ idea slug and asserts both the owner stamp and
      `sourceRef` resolve at discovery.
- [ ] The legacy-mismatch negative test asserts un-owned skip behavior is unchanged.
