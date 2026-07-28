# Conflict Check: Codex fresh-session-per-step contract (#903)

**Date:** 2026-07-27
**New stories:** `.docs/stories/codex-fresh-session-per-step-contract.md` (S1–S4)
**Scanned against:** all provider/session-bearing artifacts — `.docs/stories/{fresh-session-per-step,
per-step-provider-routing-927, first-class-codex-harness-parity-904, codex-safety-and-self-host-parity-907,
codex-auth-sandbox-permission-readiness-905, builtin-provider-installation-readiness-901,
model-and-effort-resolution-provider-aware-902, model-attribution-and-provider-defaults-931,
codex-readiness-park-970, session-fresh-verdict-artifacts,
retro-followups-per-step-provider-routing-927}.md`, `.docs/decisions/adr-2026-07-24-provider-aware-
step-execution-fresh-session-scope.md`, `adr-2026-07-24-provider-aware-step-execution.md`, and open
issues #325, #759, #1041, #1042.
**Result:** PASSED — 2 conflicts found, both resolved; 0 blocking remain.

## Conflict 1: The unqualified within-step retry-resume rule

**Artifacts involved:** `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` §2
("Retries resume only within the same step and provider", lines 43-54) and
`.docs/stories/per-step-provider-routing-927.md` ST-927-7 ("then it resumes that step-and-provider
session rather than minting a new session"; acceptance: "Retry tests prove attempts within one
step resume only the matching step-and-provider session") vs new story **S1/S2**.

**Type:** direct contradiction (behavioral requirement).
**Severity:** blocking if unresolved — a merged spec would assert Codex must resume while the new
spec asserts it must not.

**Description:** Both prior artifacts state the retry-resume exception from #325 without
qualifying it by provider. Taken literally, ST-927-7's acceptance criterion is satisfied only by
a Codex retry that resumes — which is precisely the invocation this feature makes
unconstructable. Notably the same ADR already observes at line 22 that "a session identifier
created by Claude cannot be resumed by Codex", so the ADR is internally in tension before this
feature touches it.

**Resolution applied (ADR-level partial supersession + artifact annotation):** The new ADR
records that it **supersedes in part** §2 of the 2026-07-24 ADR: the retry-resume permission is
now qualified by `supportsSessionResume`. Everything else in §2 — step scoping, no cross-step or
cross-provider resume, fallback-provider scoping, legacy-marker handling — stands unchanged and
is strengthened, not weakened. Plan Task 7 adds the qualification note to the 2026-07-24 ADR and
to the two affected story files so they do not read as false on main. No new story was needed:
S1's negative path already pins the Claude side (resume stays `true`), preserving ST-927-7's
intent for every provider that can actually honor it.

## Conflict 2: Ownership overlap with #1042 on `provider-execution.ts`

**Artifacts involved:** open issue #1042 ("Self-host sandbox provisioning and provider
thread-resume identity are not coordinated") vs new story **S1**.

**Type:** resource contention (same file, adjacent concerns) + potential requirement overlap.
**Severity:** degrading — not a contradiction, but unowned overlap invites two features editing
the same seam with different intents.

**Description:** #1042 asks for "resume eligibility [to become] a property that cannot be true
when the target home cannot contain the session — enforced structurally rather than by a flag
threaded through one call site." S1 satisfies the *structural enforcement* half of that sentence
for Codex specifically. Both touch `runProviderInvocation` and the `forceFreshSession` flag
introduced by the #1041 hotfix.

**Resolution applied (explicit scope boundary, recorded in the ADR and the architecture doc):**
#903 owns **whether dispatch requests resume** and answers "no, for Codex, structurally." #1042
retains ownership of **session identity and home provisioning** — whether the id should be read
back from Codex, whether an isolated home persists across invocations, and whether `CODEX_HOME`
belongs under `/tmp`. `forceFreshSession` is deliberately **left in place**, not removed: it is
provider-agnostic (it would also apply to a self-host Claude run) and remains #1042's seam. S1's
third negative path pins the composition — both suppressors active must yield `resume: false`
with no error — so #1042 can later change `forceFreshSession` freely without breaking this
contract.

## Verified-clean pairs (reasoned, not assumed)

- **`fresh-session-per-step.md` "Within-step retries resume the same session (not fresh)"** —
  reads as contradictory, but its stated rationale is that "the retry sees the partial work/errors
  of the prior attempt and can finish the task." S2's happy path shows that rationale is satisfied
  for Codex by the prompt, not the session: `buildSystemPrompt` prefixes `RETRY: <reason>` to the
  **full** step prompt (`step-runners.ts:1901`). Same intent, different transport. Its acceptance
  criteria are Claude-observable and remain true. Covered by the Conflict 1 annotation task; not
  a separate conflict.
- **`codex-safety-and-self-host-parity-907.md` "Preserve protections across initial, retry, and
  resume paths"** — concerns *safety-capability classification* surviving a retry, not session
  continuity. Its NP-2 ("resumed state belongs to another task, provider, phase, workspace") is
  strictly reinforced by a provider that never resumes. No contradiction.
- **`codex-auth-sandbox-permission-readiness-905` / `builtin-provider-installation-readiness-901`
  / `codex-readiness-park-970`** — auth source selection, readiness probes, and park-on-unready.
  This feature touches none of them; `authenticationResult` and the readiness path in
  `codex-provider.ts` are untouched.
- **`model-and-effort-resolution-provider-aware-902` / `model-attribution-and-provider-defaults-931`**
  — `--model` and `model_reasoning_effort` argv construction sits in the same `buildArgs` function
  this feature edits (`codex-provider.ts:499-501`), but on the lines *after* the deleted resume
  branch and independent of it. One caveat handled: removing the resume branch also removes the
  `!options.resume` guard on `--cd` (`:511`), so Codex now always receives an explicit `--cd`.
  That is strictly more correct and affects no model/effort argument. Flagged in plan Task 3.
- **`first-class-codex-harness-parity-904`** — parity work on skills/dispatch shape. It asserts
  Codex reaches feature parity on *harness capabilities*, not on session mechanics. This feature
  declares one deliberate, interface-visible divergence (resume) with a recorded rationale, which
  is the opposite of silent drift.
- **`session-fresh-verdict-artifacts` / `inline-build-work-commits-unattributed-session-hoo` /
  `missing-session-hook-files-terminally-halt-a-build`** — "session" there means the Claude Code
  *session hook* files, an unrelated namespace. No overlap.
- **#759 (Codex as an execution engine)** — this feature answers one of #759's open hypotheses
  ("Codex may work better with a single persistent session"), resolving it as *no persistent
  session, cold start per invocation*, with evidence. It supplies a prerequisite for #759 rather
  than competing with it.
