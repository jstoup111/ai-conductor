# Intake

### Intake-Issue Shape: WHAT vs. HOW

Intake issues follow a strict format that separates **WHAT** (the problem and desired state)
from **HOW** (the solution approach). This division ensures that intake captures observable
facts and outcomes, while implementation decisions remain the engineer's (DECIDE phase) responsibility.

**The four sections:**

1. **Observed** (required) — Evidence of the problem. What did you actually observe?
   Factual description of the current state, without jumping to solutions.

2. **Impact** (optional) — Who or what is hurting, and how often? Describes the scope
   and frequency of the problem to help prioritize.

3. **Desired outcome** (required) — Observable behavior that must hold afterward.
   State what success looks like in measurable, observable terms, not in terms of implementation.

4. **Hypotheses** (optional) — Your guesses about HOW to solve this. These are candidate
   ideas—DECIDE treats them as one option among many and may discard them in favor of alternatives.
   Hypotheses are the ONLY place for implementation suggestions in an intake issue.

**WHAT vs. HOW principle:** Intake issues state the **WHAT** (problem definition and desired outcomes);
the engineer during the DECIDE phase owns the **HOW** (implementation, design, technical approach).
Never prescribe implementation details, technology choices, or internal mechanisms in the Observed,
Impact, or Desired outcome sections — those belong in Hypotheses *only*, and even there they're
advisory, not binding.

**References:**
- [Intake idea issue template](../.github/ISSUE_TEMPLATE/intake.yml) — The template that enforces
  this shape when filing issues on the web or via `gh issue create`.
- [HARNESS.md Key Conventions](../HARNESS.md#key-conventions) — "Intake states WHAT and outcomes — DECIDE owns HOW"
  documents this rule in detail.

### Intake-Only Criteria Enforcement (Priority + Size + Dependency-Linking)

Every intake issue must carry the criteria the daemon backlog needs to schedule it — a
`priority:` label, a `size:` label, and (when applicable) a `blocked_by:` link — and this
harness stamps them **at intake, never downstream**. No build, gate, or CI workflow ever
blocks on missing criteria; an unlabeled issue simply defaults and moves on. See
`src/conductor/README.md` → "Intake-only criteria enforcement" for the full pipeline; summary
below.

- **Required form fields.** [`.github/ISSUE_TEMPLATE/intake.yml`](../.github/ISSUE_TEMPLATE/intake.yml)
  now has required `Priority` (`critical`/`high`/`medium`/`low`) and `Size` (`S`/`M`/`L`)
  dropdowns, plus an optional free-text `Depends on` field (issue numbers, or "none"),
  alongside the existing Observed/Impact/Desired-outcome/Hypotheses sections.

- **`intake-label-sync` Action.** [`.github/workflows/intake-label-sync.yml`](../.github/workflows/intake-label-sync.yml)
  fires on `issues: [opened, edited]`, parses the submitted form body, and stamps the
  matching `priority:`/`size:` labels plus one `blocked_by:#N` label per dependency —
  defaulting to `size: M` / `priority: medium` on unparsable or missing input rather than
  leaving the issue unlabeled. It is entirely isolated from `ci.yml`: labels-only
  permissions (`issues: write` / `contents: read`), `continue-on-error: true`, and the
  underlying `syncIssueLabels()` (`src/conductor/src/engine/engineer/intake/label-sync.ts`)
  catches all errors internally and always exits 0 — a label-sync failure can never fail a
  build or block another workflow. Idempotent: re-editing an issue re-diffs and re-applies
  labels rather than duplicating them.

- **`bin/intake-file`** — files a criteria-complete issue in one atomic operation instead of
  relying on the web form:
  ```bash
  src/conductor/bin/intake-file --title "..." --body "..." \
    [--size S|M|L] [--priority critical|high|medium|low] \
    [--depends-on owner/repo#N ...] [--repo owner/repo]
  ```
  Size and priority are resolved in order: explicit flag ▸ prompted (interactive TTY) ▸
  inferred from the body ▸ defaulted. `--depends-on` may repeat; when omitted interactively
  the tool records an explicit "no dependencies" acknowledgement rather than silently
  leaving the field blank. Exits 0 once the issue is created, even if label application or a
  dependency link partially fails — those surface as warnings, never as a filing failure.
  Backed by `fileIntakeIssue()` (`src/conductor/src/engine/engineer/intake/file-issue.ts`).

- **`bin/intake-backfill`** — a one-shot, non-interactive sweep for the existing backlog:
  ```bash
  src/conductor/bin/intake-backfill --repo owner/repo
  ```
  Lists open issues assigned to the authenticated `gh` user, backfills any missing
  `size:`/`priority:` labels (infer from body ▸ default), and prints an operator report
  (labelled/skipped/failed breakdown). Per-issue failures are isolated and never abort the
  sweep; it is idempotent, safe to re-run, and never HALTs. Run it once after adopting this
  feature to catch up pre-existing backlog issues that predate the required form fields, or
  any time issues were filed by hand (`gh issue create`) bypassing `bin/intake-file`.
  Backed by `backfillIntakeLabels()` (`src/conductor/src/engine/engineer/intake/backfill.ts`).
