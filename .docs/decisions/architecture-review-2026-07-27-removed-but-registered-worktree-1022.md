# Architecture review (lightweight) — removed-but-registered worktree 128 loop (#1022)

Status: APPROVED

Tier M → lightweight review. Scope: record-aware prunable detection and prune
reconciliation in `worktree-shared.ts`, plus a durable auto-park on worktree-creation
failure in `daemon-runner.ts`. No new data models, no new services, no schema change.

## Feasibility

Feasible and low-risk. Every primitive already exists: `git worktree prune` is already used
elsewhere in the codebase (`worktree.ts:87`), and `writeAutoPark` (`park-marker.ts:220`) is
an established durable surface already honored by `pickEligible` (`daemon.ts:136`). The
change adds no new persistence format and no new command.

The reproduction was performed end to end in a throwaway repository this session, including
both candidate remedies, so the failure and the fix are observed rather than inferred. The
one non-obvious implementation detail — that `prunable` is a **sibling line inside the same
blank-line-separated porcelain record**, not a modifier on the `worktree` line — is
confirmed against real `git worktree list --porcelain` output and is called out explicitly in
the plan so the parser is not written line-wise.

## Alignment checks

- **Deterministic where possible; LLM only where necessary.** ✔ This is the design principle
  applied literally. CLAUDE.md rule 2 and `docs/runbooks/worktree-and-evidence-recovery.md`
  already tell a human that a prunable registration causes a 128 spin and that `prune` is the
  remedy; this PR converts that prose into machinery that reconciles at the point of failure.
  The runbook's own "Symptom" list names this exact `fatal:` string — the repo has been
  documenting a bug it can fix mechanically.
- **Daemon Operations Safety.** ✔ `git worktree prune` removes only registrations whose
  directory is already gone. It deletes no branch and no live worktree, so it does not go
  near rule 1's bulk-delete hazard. Rule 2's "never unpark-then-delete guarantees a 128 spin"
  is precisely the loop this closes.
- **Fail-closed on the unknown.** ✔ Layer 3 records and gates *any* creation failure, not
  only the prunable one. A 128 from a cause we have not diagnosed now parks with evidence
  instead of spinning silently.
- **Test isolation policy.** ✔ No third-party boundary is involved; git is a local binary.
  `worktree-shared.test.ts` mocks execa entirely and the new cases extend that mock (see the
  risk table for the one required deviation).
- **Docs track features.** ✔ `docs/runbooks/worktree-and-evidence-recovery.md` is the
  canonical affected page and must move the prunable case from "operator runs prune" to
  "engine reconciles automatically; here is what an auto-park from this cause looks like and
  how to clear it". `docs/guides/running-the-daemon.md` gains the new auto-park reason.
- **Integrity suite.** ✔ Touches no SKILL.md, no model table, no template, no bash script.
- **Release gates.** ✔ Pre-v1, so VERSION is not bumped (CHANGELOG `[Unreleased]` only). No
  `bin/conduct` CLI, hook-wiring, skill-symlink, or `settings.json` schema change — so no
  migration block and no release waiver are required.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| A line-wise parser silently keeps the bug (the `prunable` line is a sibling, so a naive filter still matches the `worktree` line). | Parse porcelain into blank-line-separated records. A story asserts the exact real-git record shape, including the `prunable gitdir file points to non-existent location` line, as a fixture. |
| Filtering prunable **without** pruning just moves the 128 from the create path to the attach path. | Verified in reproduction and pinned by a dedicated story: after reconciliation the attach must succeed, not merely be attempted. Layers 1 and 2 ship together in the same PR; neither is independently sufficient. |
| An over-broad or unconditional `prune` perturbs a healthy repo or masks an undiagnosed stale entry. | Prune fires only when a prunable record **for the requested path** was observed. A story pins that a healthy repo's git call sequence is unchanged. |
| Breaking the lazy-`resolveBase` contract while restructuring `ensureWorktree`. | Existing daemon-deps test asserts the exact call ordering; a story re-pins `resolveBase` is not called on the reuse/attach paths. |
| The auto-park is mistaken for an operator park, or cannot be cleared. | Written via `writeAutoPark`, preserving the `auto-parked:` provenance prefix that `getProvenanceType` reads; a story asserts provenance and that `conduct daemon unpark` clears it. |
| An auto-park that outlives the condition wedges a feature that is now fine. | The park body carries the concrete remedy and the slug; unpark is the existing one-command operator action. Documented in the runbook. Deliberately preferred over auto-clearing: a silent self-unpark would reintroduce an unobserved retry loop. |
| The existing execa mock "trips a vitest spy settled-result artifact" on rejection (noted at `worktree-shared.test.ts:90-95`). | Follow the file's established pattern — throw from inside `mockImplementation`'s branch for the failing subcommand (as the `show-ref` branch already does at line 31) rather than `mockRejectedValue`. Called out in the plan so the implementer does not rediscover it. |
| Engineer-path regression while fixing the daemon path. | Both callers share one mechanism; a story covers the engineer's FR-7 strict-abort message replacing the bare `ENOENT`, so the shared change is proven at both call sites. |

## Verdict

Approved for stories + plan. One ADR
(`adr-2026-07-27-worktree-prune-reconciliation-and-creation-failure-park.md`, APPROVED)
records the two decisions: prune-at-the-seam over `add -f`/startup-prune, and auto-park over
`.pipeline/HALT` for a failure that precedes the worktree's existence.
