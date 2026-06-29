# Retro: Daemon Supervised Hosting (PR #143)

**Date:** 2026-06-29 | **Stats:** 4 BUILD batches, 1 manual-test bug→fix cycle, 1 necessary human gate (ADR-005 supersession), 3 domain-review vetoes (all valid), ~1979 tests passing, 15/15 FRs ALIGNED, as-built APPROVED WITH DRIFT NOTES

## Part A: Harness

- **H-1 (Correctness):** A real bug — pane-targeting tmux verbs need `=<session>:`, not the bare `=<session>` (`capture-pane`/`send-keys` fail "can't find pane" on real tmux) — escaped the ENTIRE injected-runner unit+acceptance suite and was caught only by the real-tmux manual-test smoke. An injected runner asserts the argv the code *produces*, so a wrong-but-self-consistent argv passes green. Severity: high (silent escape). Fix: for any adapter that wraps an external binary, `writing-system-tests` MUST require ≥1 real-binary integration smoke (not only injected-runner argv assertions); add a stories negative-path category "external-tool argv validated against the real tool."
- **H-2 (Gate quality):** Two of the three valid domain vetoes (port-level `-r` threading; status probe re-encoding tmux argv outside `daemon-tmux.ts`) were caught post-GREEN; the RED specs could have pinned them. `writing-system-tests §3d` ("verify through the port / real entry point, not the helper") was applied for routing but not auto-applied to the adapter argv. Severity: medium. Fix: make "assert through the port, never the helper, for any port/adapter feature" an explicit RED checklist item in `writing-system-tests`.
- **H-3 (Autonomy — necessary, but preventable-earlier):** The ADR-005 Condition-2 (detached `stdio:'ignore'`) vs ADR-014 (foreground-in-session) conflict surfaced as a BLOCKING gate during BUILD (Batch 3), not at DECIDE. The human decision itself was necessary; surfacing it late was not. Severity: medium. Fix: `architecture-review`, when a new ADR supersedes a *mechanism*, should grep prior APPROVED ADRs for that mechanism and explicitly reconcile each in the new ADR — catch the conflict at DECIDE.

## Part B: Application

- **A-1 (Dead-ish surface):** `Supervisor.logs` (`capturePane`) and `Supervisor.exec` (`sendKeys`) have no production caller (`daemon-tmux.ts:286-296`); the port is complete ahead of use. Severity: low (intentional port completeness, ADR-noted). Fix → story: wire an operator `daemon logs --live` (capturePane) path or formally accept the YAGNI.
- **A-2 (Misleading name):** `launchDaemonDetached` (`engineer/daemon-launch.ts`) no longer detaches via node spawn — it delegates to `supervisor.start` (`tmux new-session -d`). Severity: low. Fix → story: rename to `launchDaemon` (touches the symbol, the lazy import in `daemon-lock.ts:481`, and tests).
- **A-3 (Test quality):** The `capturePane`/`sendKeys` unit tests asserted the buggy `=<name>` argv and passed (they encoded the bug — see H-1). Self-referential argv assertions with no ground truth are fragile. Severity: medium. Fix: pane-target argv tests now corrected and backed by the real-tmux smoke; codify via H-1.
- **A-4 (Pre-existing debt, not this feature):** `CHANGELOG.md` has three `## [Unreleased]` headers (lines 11/717/1260) — a release-workflow/integrity smell that the integrity check ("has an [Unreleased] section") does not catch. Severity: low. Fix → story: dedupe to one canonical `[Unreleased]`; tighten the integrity check to assert exactly one.

## Part C: Context Efficiency

- **C-1:** prd-audit ran 2 opus agents for 15 FRs that each had a passing test. For a fully test-backed Medium feature, a single sonnet auditor with the evidence map would likely suffice. Fix: `prd-audit` SKILL.md — when every FR traces to a passing test, allow 1 sonnet pass (reserve per-FR/opus for untested or security FRs).
- **C-2:** Two initial Explore agents mapped the daemon code, but the delicate Batch-3 test rewrite still required full re-reads of `daemon-launch.test.ts` + `non-autonomy.test.ts`. Some overlap. Fix: have the Explore map include test-file inventories per source file so the rewrite phase reads once.
- **C-3:** ~14 subagent dispatches total (RED/GREEN/domain ×4 + 2 audit + as-built) — proportionate given the 11-file surface and the approved-ADR supersession. No change; Batch 3's opus domain review was justified by the non-autonomy sensitivity.

## Trends

- First feature run as a **DECIDE-backfill from an existing `/engineer` handoff plan** — the staged-checkpoint TDD held; domain reviews caught 3 real gaps (consistent with the "TDD cycle is sacred / negative-path" memory).
- Repeat of the **"green tests against an unverified primitive"** class (memory: orphaned-primitives, false-pass) — here as injected-runner-vs-real-binary (H-1). Recurring enough to warrant the `writing-system-tests` change.
