---
name: conflict-check
description: "Use after writing stories, before creating an implementation plan, or when adding features to an existing system. Detects contradictions, overlaps, state conflicts, and resource contention between stories."
enforcement: gating
phase: decide
standalone: true
requires: []
---

## Purpose

Detects when new stories contradict, overlap, or create impossible states with existing ones.
Provides guided resolution so conflicts are resolved before implementation begins — preventing
the expensive discovery of contradictions during or after coding.

**Correctness gate:** "these two stories conflict" (or "clean") is a judgment call. Per the
`/verify-claims` protocol, ground each asserted conflict in the specific contradicting text with a
confidence %, and do not declare a clean pass on the *assumption* that two stories are compatible
when their interaction was never actually reasoned through — an unexamined pair is not a verified
clean pass.

## Practices

### 1. Inventory

Load ALL stories and specs:
- All files in `.docs/stories/` (existing + newly written)
- Active specs from `.docs/specs/` (for design-level context)
- Previous conflict reports from `.docs/conflicts/` (to check for recurring patterns)

### 1b. As-Built Story Handling

When stories have `[AS-BUILT]` markers (from `/bootstrap`), they document **existing working
code**. Overlap between as-built stories is expected — the same endpoint may appear in multiple
stories describing different aspects of the same feature.

**Scoring adjustment for as-built pairs:**
- Two `[AS-BUILT]` stories sharing an endpoint → **not a conflict** unless they assert
  contradictory behavior. Same endpoint, same behavior, different story angle = normal.
- `[AS-BUILT]` vs new story → check normally. New work may genuinely conflict with existing behavior.
- Two new stories → check normally.

This prevents false positives when bootstrapping an existing codebase where stories naturally
overlap because they were reverse-engineered from the same working system.

### 2. Conflict Scan

Check each pair of stories for these conflict types:

#### Contradiction
Stories that directly oppose each other.
- Story A: "Users must authenticate to view orders"
- Story B: "Anonymous users can browse the order catalog"
- Conflict if both reference the same resource/endpoint.

#### Behavioral Overlap
Stories that modify the same entity, flow, or endpoint in incompatible ways.
- Story A: "Admins can soft-delete users" (sets `deleted_at`)
- Story B: "Users with activity in the last 30 days cannot be deleted"
- Overlap: What happens when an admin tries to soft-delete an active user?

#### State Conflict
Combined stories create impossible or ambiguous system states.
- Story A: "Orders are immutable after confirmation"
- Story B: "Customer support can edit confirmed order addresses"
- Conflict: An order cannot be both immutable and editable.

#### Resource Contention
Stories assume exclusive access to shared resources.
- Story A: "The `status` column tracks order lifecycle"
- Story B: "The `status` column tracks payment state"
- Conflict: Same column, different semantic meanings.

#### Sequencing Conflict
Stories that each assume they run first, or create circular dependencies.
- Story A: "User profile must exist before creating an order"
- Story B: "First order creation triggers profile setup"
- Conflict: Circular dependency on which comes first.

### 3. Generate Conflict Report

For each conflict found:

```markdown
## Conflict: [Short description]

**Stories involved:** [Story A title] vs [Story B title]
**Files:** [.docs/stories/file-a.md] vs [.docs/stories/file-b.md]
**Type:** contradiction | overlap | state-conflict | resource-contention | sequencing
**Severity:** blocking | degrading

**Description:**
What specifically conflicts and why both cannot be true simultaneously.

**Resolution Options:**
1. [Least disruptive option — modify one story to accommodate the other]
2. [Moderate option — modify both stories to meet in the middle]
3. [Most disruptive option — introduce new mediating behavior]

**Recommendation:** Option [N] because [rationale].
```

**Severity definitions:**
- **blocking** — Cannot proceed to implementation. Stories are mutually exclusive.
- **degrading** — Can proceed with a known compromise. Both stories work but with reduced functionality in the overlap area.

### 4. Guided Resolution

Present all conflicts to the user at once, grouped by severity (blocking first).

For each conflict:
1. Explain what conflicts and why
2. Present resolution options ranked by impact (least disruptive first)
3. Include a recommendation with rationale
4. User selects a resolution

After user selects:
1. Update the affected stories in `.docs/stories/` to reflect the resolution
2. Note what changed and why in the story file
3. Save the conflict report to `.docs/conflicts/YYYY-MM-DD-<description>.md`

**Conflict reports are overwritten on re-run.** If a re-check after resolution finds new or
changed conflicts, overwrite the existing conflict report file. The report reflects the CURRENT
state — git has the history.

**Conflict resolutions that change architectural decisions create new ADRs.** Never overwrite
an existing ADR. Instead:
1. Write a new ADR in `.docs/decisions/` (named `adr-YYYY-MM-DD-<kebab-slug>.md`, no
   sequential numbers) that supersedes the old one
2. Update the old ADR's status to `Superseded by <new-adr-slug>` (the new ADR's filename stem)
3. The new ADR references the old one and explains why the decision changed

Example: If conflict resolution changes the API authentication approach from
`adr-2026-05-01-api-auth-strategy`, create `adr-2026-06-29-api-auth-token-exchange` with the new
approach and mark the old one as superseded.

### 5. Re-Check

After all resolutions are applied, re-run the full conflict check.

**GATE: Loop until the check passes clean (zero blocking conflicts).**

Degrading conflicts may remain if the user explicitly accepts the compromise.

### 5c. Route a Blocking Conflict by Root Cause (kickback)

A story-vs-story conflict is usually a *symptom*; fix it where the contradiction is rooted, not
always in the stories. Classify each blocking conflict's root and route the kickback to the right
upstream gate (`prd` and `architecture_review` are kickback targets; the recovery/back-navigation
menu lists them):

- **Contradictory product requirements (FRs)** → kick back to **`prd`** (product track). The two
  stories conflict because the PRD's FRs themselves conflict; the PRD must be reconciled first.
- **Incompatible design / ADR** → kick back to **`architecture`** (architecture-review). The conflict
  stems from the chosen design; architecture-review re-opens in *amendment* mode to resolve the
  specific structural gap, then stories re-derive.
- **Pure story-phrasing overlap** → resolve in **`stories`** (the default — Section 4).

Only route up when the root genuinely lives upstream; a phrasing nit stays in stories. In an
interactive run, surface the root + target and navigate back to it. In an unattended/daemon run a
blocking conflict HALTs for a human (no silent pass).

### 6. Clean Pass

When no blocking conflicts remain:
- Report "Conflict check passed" with summary
- Note any accepted degrading conflicts
- Suggest invoking the `plan` skill

### 7. Signal Review Requirement

Before exiting, decide whether the conductor should prompt the user to review
the conflict report(s). Review mode for this step is **conditional** — auto-approved
unless you write a marker file.

Write `.pipeline/review-required-conflict_check` (any content; the file's
existence is the signal) if ANY of the following is true:

- Blocking conflicts were found (even if resolved — the user should see what
  was reconciled)
- Degrading conflicts were accepted
- Any conflict resolution created a superseding ADR

If the report shows zero conflicts and zero resolutions, do NOT write the
marker — the conductor will auto-approve and move to the next step.

```bash
# Example: write the marker when issues were found
mkdir -p .pipeline
echo "blocking conflicts resolved: 2, degrading accepted: 1" > .pipeline/review-required-conflict_check
```

## Verification

- [ ] All stories in `.docs/stories/` scanned (not just new ones)
- [ ] All 5 conflict types checked (contradiction, overlap, state, resource, sequencing)
- [ ] Each conflict has severity, description, and resolution options
- [ ] User selected resolution for each blocking conflict
- [ ] Affected stories updated to reflect resolutions
- [ ] Conflict reports saved to `.docs/conflicts/`
- [ ] Re-check passed clean after resolutions
- [ ] Zero blocking conflicts remain before proceeding
- [ ] `.pipeline/review-required-conflict_check` marker written IF any conflict
      was found/resolved or degrading conflict was accepted (skip if truly clean)
