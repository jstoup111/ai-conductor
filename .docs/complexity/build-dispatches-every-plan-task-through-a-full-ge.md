# Complexity: Declared pattern replication for Nth-of-a-kind BUILD work

Tier: M

## Rationale

**Signals present**

- **Multi-skill coordination (4 skills).** The feature changes behavior in `plan` (new grammar),
  `writing-system-tests` (copy + rename the source feature's acceptance specs), `pipeline` (a
  declared replication task and delta-only TDD for the rest), and `simplify` (suppress the reflex
  duplication flag for declared replications while retaining extraction judgement).
- **Two conductor steps affected.** `acceptance_specs` (`steps.ts:132-141`) and `build`
  (`steps.ts:143-152`), at different granularities — feature-level and per-task.
- **Net-new engine machinery.** A deterministic copy-equivalence check (copy == source modulo a
  declared rename map). The engine has no content-comparison capability today: no diff, no
  similarity, no edit distance; `copyFile` appears twice and both are scaffolds. Everything else
  compares paths, never contents.
- **New parsed plan grammar** with fail-closed path resolution, plus the validation and
  documentation surface a per-plan field is held to in this repository.

**Signals absent**

- No models, no external integrations, no auth, no state machine, no data migration.
- No new conductor step, no new artifact type, no new skill, no CLI-breaking change.

**Not L** because the work is bounded to one repository's own harness plumbing with no
distributed or stateful surface. **Not S** because it spans four skills and two steps with
net-new engine machinery, which is exactly the shape that under-delivers when authoring
ceremony is skipped.
