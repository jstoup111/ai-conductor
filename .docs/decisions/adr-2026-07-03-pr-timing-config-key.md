# ADR: `pr_timing` config key — one setting, two publish flows

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session

## Context

Push + PR creation happen at a fixed point in both publish flows: the daemon build pushes
and opens the implementation PR inside the auto-mode `/finish` prompt
(`step-runners.ts:610-639`), and the engineer spec flow pushes/opens the spec PR only at
`handoff` (`handoff.ts:170`, `gh pr create --head <branch> --fill`, non-draft, push as a
side effect). Fixed finish-time publishing means no remote visibility into in-flight work
and no incremental CI. Operator expanded intake issue jstoup111/ai-conductor#199 to cover
both flows under one setting.

## Options Considered

### Option A: One top-level key `pr_timing: finish | early-draft`, applied to both flows
- **Pros:** Single mental model; matches the operator's "both flows, one config" decision;
  smallest schema surface; follows `rebase_resolution_attempts` resolver precedent.
- **Cons:** Cannot set the flows independently (defer per-flow subkeys until needed).

### Option B: Nested block with per-flow subkeys (`pr_timing: { build:…, spec:… }`)
- **Pros:** Independent control.
- **Cons:** More surface than the requirement; can be introduced later as a compatible
  extension (string form = both flows).

### Option C: Include a `per-task` mode now
- **Cons:** No TS hook exists — task commits happen inside the `/pipeline`→`/tdd` skills;
  supporting it means changing skill contracts. Explicitly deferred by the operator.

## Decision

Option A. One top-level key in `.ai-conductor/config.yml`:

```yaml
pr_timing: finish   # default — byte-for-byte current behavior
# pr_timing: early-draft
```

- **Validation is fail-closed** (owner-gate `owner_gate_cutover` precedent,
  `config.ts:480-490`): any value other than `finish` / `early-draft` rejects config load.
  A typo must never silently pick a publish mode. Key added to `knownTopLevelKeys`
  (`config.ts:154-178`) and `HarnessConfig` (`types/config.ts`).
- **Absent key → `finish`** via a total resolver `resolvePrTiming()` in
  `resolved-config.ts` (mirror of `resolveRebaseResolutionAttempts`,
  `resolved-config.ts:274-296`). Config is read once at daemon startup
  (`daemon-cli.ts:184`) and flows via `Conductor.config` / `DefaultStepRunner.config`;
  the engineer commands read it per invocation. No mid-run re-reads.
- **`early-draft` semantics (both flows):** publish early as a **draft** PR, refresh at
  natural boundaries, mark ready at the flow's existing terminal publish point. Early
  publishes are **advisory**: a failed push or PR creation logs loudly and never blocks
  the build or the authoring session — only the terminal publish is load-bearing.
- **Lazy PR creation:** the draft PR is created on the first push where the branch is
  ahead of its base (`git rev-list --count base..HEAD > 0`), never on an empty branch —
  `gh pr create` fails with "no commits between" otherwise. Until then, early mode only
  pushes the branch.
- **All publish operations route through the `pr-labels.ts` seam** (injectable
  `GhRunner`/`GitRunner`, `makeProductionGh`/`makeProductionGit`, test kill-switch;
  `pr-labels.ts:26-76`) — the same seam `build-failure-escalation.ts:77-78` already uses.
  A new `pushBranch` primitive joins `findOrCreatePr` / `markReadyForReview` there. No raw
  `execFile` publishes. This keeps the EKS/isolated-remote constraint
  (adr-2026-06-30-self-host-detection-seam precedent): swap the runner, not the callers.

Dedup/intake safety (verified, no code change needed): draft PRs are invisible to every
existing scan — daemon backlog reads only the merged base-branch tree
(`daemon-backlog.ts:34-70`), intake dedup keys on `source+sourceRef` (adr-012), owner-gate
runs only over merged specs. Early publishing cannot confuse another operator's daemon.

## Consequences

### Positive
- In-flight builds and long DECIDE authoring sessions are watchable from a phone; CI runs
  incrementally on draft PRs.
- Default is inert; consumers opt in per project.
- One resolver, one seam — testable with injected runners, no leaked processes.

### Negative
- Draft PRs consume CI minutes during builds (accepted — it is the point of the mode).
- Two flows share one knob; per-flow control requires a future compatible extension.

### Follow-up Actions
- [ ] Add key to `HarnessConfig`, `knownTopLevelKeys`, fail-closed validation block
- [ ] Add `resolvePrTiming()` + `DEFAULT_PR_TIMING = 'finish'` in `resolved-config.ts`
- [ ] Add `pushBranch` primitive to `pr-labels.ts`
- [ ] Document the key in `src/conductor/README.md` (mirror `README.md:261-265` block) + CHANGELOG
