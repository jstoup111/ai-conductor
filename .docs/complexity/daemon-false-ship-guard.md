# Complexity: daemon-false-ship-guard

Tier: M

## Rationale

- **Scope:** two independent engine guards + a skill gate — finish completion predicate
  (`artifacts.ts`), daemon ship branch (`daemon-runner.ts` / `daemon-deps.ts`), and
  `skills/finish/SKILL.md` Section 5. Multi-file, single subsystem (conductor engine).
- **State machine:** extends the finish→DONE→ship convergence rules (a `keep`/`merge-local`
  finish no longer converges DONE in daemon mode; null/unverified prUrl no longer ships) and
  adds a HALT-for-remediation path reusing the existing escalation primitive. No new state
  stores; the processed-marker schema is unchanged (status redesign deferred).
- **Integrations:** none new — uses existing git/gh runners and `surfaceRemediationPr`.
  No auth, no models, no external services.
- **Testing:** unit tests with injected deps (daemon-runner, artifacts predicate) + one
  push-evidence check against a temp git repo, following existing patterns
  (`build-failure-escalation.test.ts` fakeGit, `artifacts.test.ts` temp-dir markers).
- **Story count:** ~4–6 stories (gate evidence, daemon guard, HALT path, skill gate,
  negative paths).

Not S: multi-file gating-semantics change with a new remediation route and adversarial
negative paths. Not L: no schema/API change, no new integration, single-repo engine work.
