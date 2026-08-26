# Stories: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

Track: technical
Source: jstoup111/ai-conductor#1736
Governing decision: adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts
Review conditions: .docs/decisions/architecture-review-2026-08-19-plan-tasks-can-declare-a-protected-artifact-outcom.md

Acceptance criteria live here (technical track — no PRD).

Each criterion below is a single Given/When/Then statement under its story's Happy Path or
Negative Paths heading — the shape the engine's authoritative criterion extractor consumes.

---

## Story 1 — A task that declares `**Files:**` still has its body prose scanned

`scanPlanProtectedTargets` examines a task's `**Files:**` paths **or** its body prose, never both,
so any task declaring a `**Files:**` line has its prose skipped entirely. This is the sole defect
that produced ai-conductor#1736: the incident task declared
`**Files:** .docs/validation/<report>.md`, so the foreign ADR named in its body was never scanned.

### Happy Path

- **Given** a plan task declaring `**Files:** .docs/validation/report.md` whose body backtick-cites another feature's `.docs/decisions/adr-2026-01-01-other.md`, **When** `scanPlanProtectedTargets` runs, **Then** it returns a violation naming that task id and that ADR path
- **Given** that same task with its `**Files:**` line removed, **When** the scanner runs, **Then** it still returns the same violation, proving the union did not disable the prose branch

### Negative Paths

- **Given** a task declaring `**Files:** .docs/stories/<this-plan-stem>.md`, **When** the scanner runs, **Then** it returns no violation, because the seal reports own-feature drift as a tolerated `selfAmendment` (governing ADR §3)
- **Given** a task whose `**Files:**` line and body prose name only `src/` and `.docs/validation/` paths, **When** the scanner runs, **Then** it returns no violation
- **Given** every plan under `.docs/plans/` on the default branch, **When** the scanner runs over each, **Then** it reports only genuine violations and each reported violation names a real protected path present in that task

---

## Story 2 — The CLI stops advising the edit that hides the violation

`cli.ts:433` prints "add `**Files:**` to declare the task's targets" — the change that silences the
prose scan. An author following the tool's own guidance conceals the defect rather than fixing it.

### Happy Path

- **Given** a plan carrying a protected-target violation, **When** `conduct-ts plan-protected-targets <plan>` runs, **Then** it exits non-zero, names the task and the protected path, directs the amendment to DECIDE, and does not instruct the author to add a `**Files:**` line

### Negative Paths

- **Given** a plan with no violations, **When** the command runs, **Then** it prints the no-violations message and exits 0

---

## Story 3 — The authoring contract states the rule the engine enforces

`skills/plan/SKILL.md:143-147` scopes the prohibition to the `**Files:**` set and omits
`.docs/decisions/` — so the skill told the author an ADR-checkbox task was permitted.

### Happy Path

- **Given** the sealed-artifact prohibition in `skills/plan`, **When** it is read, **Then** it names `.docs/decisions/` alongside architecture, plans, specs, and stories, matching `PROTECTED_ARTIFACT_DIRECTORIES` exactly
- **Given** `HARNESS.md:123-124` and `skills/remediate/SKILL.md:101`, **When** they are read, **Then** both name `.docs/decisions/` in the sealed set

### Negative Paths

- **Given** that same `skills/plan` section, **When** it is read, **Then** it prohibits directing an amendment to another feature's sealed artifact anywhere in a task rather than only on the `**Files:**` line, while preserving the existing own-feature carve-out

---

## Story 4 — The governing ADR's directory list matches the code

The ADR's §3 says "the four sealed directories only" and omits `.docs/decisions/`, while the code
has had five throughout. The incident artifact was an ADR under the omitted directory.

Delivered during DECIDE, not by BUILD — the file is under `.docs/decisions/`, so tasking its
mutation would commit the exact violation this feature prevents. That ADR's own §1 codifies both
the note form and the DECIDE-performs-it rule.

### Happy Path

- **Given** `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` §3, **When** the spec branch is read, **Then** a `> **Amended 2026-08-19 by #1736:** …` note sits beside the original sentence naming the fifth directory

### Negative Paths

- **Given** that same amended §3, **When** the spec branch is read, **Then** the original sentence is neither rewritten nor deleted

---

## Story 5 — An operator can recover a build already caught by this deadlock

The governing ADR §5 accepts that a mid-BUILD discovery reaches a human: "a residue that needs a
human is acceptable where a bypass is not." That residue needs a documented recovery.

### Happy Path

- **Given** a build failing `build_review` completeness on an outcome satisfied in a protected artifact routed through the default branch, **When** an operator opens the runbook, **Then** it identifies the signature (a `missing-outcome` finding whose evidence cites only the plan and the diff, plus `remediation_sealed_artifact_redirect` events), gives `conduct-ts build-review accept` with a sealed-artifact rationale as the sanctioned exit, and states the durable fix: amend in DECIDE and re-author the task, never task the mutation

### Negative Paths

- **Given** the new runbook, **When** the plan is read, **Then** no task edits `docs/runbooks/index.md` or README's runbook list, because registering it belongs to the gating `maintain-documentation` step

---

Status: Accepted
