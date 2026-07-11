# Components: finish-record primitive — deterministic finish-choice marker write (issue #281)

**Last updated:** 2026-07-07
**Scope:** The finish-step completion seam in daemon auto mode — step dispatch, the finish
skill session, the new `conduct-ts finish-record` primitive, the completion markers, and
the finish completion gate. Tier M, technical track.

## Diagram

```mermaid
graph TD
    subgraph Daemon["Daemon (auto mode)"]
        SR["step-runners.ts<br/>buildStepPrompt: finish + auto-mode<br/>exit contract (absolute paths)"]
        GATE["artifacts.ts finish verifier<br/>fresh finish-choice + pr_url +<br/>halt-title + push-evidence checks<br/>(UNCHANGED)"]
    end

    subgraph Session["Finish skill session (haiku, print mode)"]
        SKILL["skills/finish/SKILL.md<br/>GATE 0, fresh suite, staleness proof,<br/>push + PR via /pr"]
        EXIT["Auto-mode exit contract (NEW):<br/>end with ONE command"]
    end

    subgraph CLI["conduct-ts CLI"]
        FR["finish-record (NEW)<br/>--choice pr|keep --pr-url «url»<br/>--pipeline-dir «abs»"]
        V1["verify: gh pr view --json url<br/>non-empty"]
        V2["verify: git merge-base --is-ancestor<br/>HEAD refs/remotes/origin/«branch»"]
        W["atomic write:<br/>.pipeline/finish-choice<br/>+ pr_url into conduct-state.json"]
    end

    MARKERS[(".pipeline/finish-choice<br/>.pipeline/conduct-state.json<br/>(worktree, absolute path)")]

    SR -->|"dispatch /finish print turn"| SKILL
    SKILL --> EXIT
    EXIT -->|"conduct-ts finish-record"| FR
    FR --> V1
    FR --> V2
    V1 -->|"pass"| W
    V2 -->|"pass"| W
    V1 -.->|"fail → exit non-zero,<br/>NO writes (fail-closed)"| EXIT
    V2 -.->|"fail → exit non-zero,<br/>NO writes (fail-closed)"| EXIT
    W --> MARKERS
    GATE -->|"reads after step"| MARKERS
```

## Legend

- **NEW** — surfaces added by this feature: the `finish-record` subcommand and the
  SKILL.md auto-mode exit contract that invokes it.
- **UNCHANGED** — the completion gate in `artifacts.ts` keeps its exact semantics; the
  primitive satisfies the gate, it does not replace or weaken it. Push-evidence and
  halt-PR-rehabilitation checks in the gate still run independently.
- Dashed edges are failure paths: any verification failure (or gh/git error) exits
  non-zero and writes **nothing** — the missing marker remains the signal that finish
  did not complete, exactly as today (fail-closed).
- `keep` choice: verifications V1/V2 are skipped (no PR involved); only the
  `finish-choice` marker is written. `merge-local` / `discard` are rejected in daemon
  mode by the existing gate, so the primitive only accepts `pr` and `keep`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for issue #281 (engineer flow) |
