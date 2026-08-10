---
name: conflict-check
description: "Use after writing stories, before creating an implementation plan, or when adding features to an existing system. Detects contradictions, overlaps, state conflicts, resource contention, and oscillating requirements that are individually satisfiable but mutually exclusive in practice — the pair that sends work round a kickback loop that never terminates."
enforcement: gating
phase: decide
standalone: true
requires: [verify-claims]
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
- Approved ADRs from `.docs/decisions/` (as selected below)
- Previous conflict reports from `.docs/conflicts/` (to check for recurring patterns)

Read `conflict_check.adr_corpus`; if it is unset, use `change_set`.

- `change_set` — load the approved ADRs in the current spec's change set. This is the default
  corpus. Do not narrow it or parse supersession status.
- `repo_wide` — load all approved ADRs, narrow the corpus to ADRs whose subject overlaps the
  current spec's stories, and record both the examined and narrowed-out ADRs in the conflict
  report. Apply supersession-status parsing only at this scope: exclude an ADR only when it is
  unambiguously fully superseded; retain an ADR with a partial or ambiguous supersession because
  its remaining decision may still conflict with a story.

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

Also compare each selected ADR against every story whose behavior, entity, field, resource, or
gate it addresses. Apply the same six conflict types and the same two-directional heuristic to
an ADR-versus-story pair; ADRs are a comparison party, not a seventh conflict type.

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

#### Oscillating Conflict
Two requirements that are each individually satisfiable but **mutually exclusive in
practice**, so satisfying one re-breaks the other. This is the costliest conflict type
and the hardest to see, because nothing looks wrong at authoring time — both stories
read as reasonable, and each is implementable on its own.

- Story A: "Every batch boundary blocks until the evaluator has written a verdict"
- Story B: "A batch with no code changes skips evaluator dispatch to save tokens"
- Conflict: a no-change batch must both block on a verdict and never request one. An
  implementation satisfying A fails B's gate; the fix for B then fails A's gate.

The damage is not a failed build — it is a **loop that does not terminate on its own**.
Gate A kicks the work back, the fix trips gate B, gate B kicks it back, and each lap
costs a full agent session. A static contradiction announces itself the first time
someone tries to write the code; an oscillation only announces itself as unexplained
rework, several steps downstream, where nobody is looking at the stories any more.

**Detection heuristic:** for each pair of stories touching the same behavior, entity,
field, or gate, ask **"if I fully satisfy A, does B still hold?"** — then ask it in the
other direction. Two "no" answers is an oscillation, however sensible each story reads
alone. One "no" is an ordinary contradiction or overlap; classify it as those instead.

Oscillations are almost always **blocking**, even when each story looks harmless,
because there is no implementation that satisfies both and no amount of rework will
find one. Resolving it requires changing what is being asked for, not how it is built —
which usually means the root lives upstream (see 5c) in the PRD's FRs or in the design,
not in story phrasing.

### 3. Generate Conflict Report

For each conflict found:

```markdown
## Conflict: [Short description]

**Stories involved:** [Story A title] vs [Story B title]
**Files:** [.docs/stories/file-a.md] vs [.docs/stories/file-b.md]
**Type:** contradiction | overlap | state-conflict | resource-contention | sequencing | oscillating
**Severity:** blocking | degrading

**Description:**
What specifically conflicts and why both cannot be true simultaneously.

**Resolution Options:**
1. [Least disruptive option — modify one story to accommodate the other]
2. [Moderate option — modify both stories to meet in the middle]
3. [Most disruptive option — introduce new mediating behavior]

**Recommendation:** Option [N] because [rationale].
```

For an ADR-versus-story conflict, use the same report format and additionally include this
grounding block. `ADR filename stem` is the ADR filename without `.md`; `Story ID` is the story's
declared identifier.

```markdown
**ADR filename stem:** adr-YYYY-MM-DD-decision-slug
**Story ID:** STORY-N
**ADR opposing sentence (verbatim):** "<exact sentence from the ADR>"
**Story opposing sentence (verbatim):** "<exact sentence from the story>"
```

Record an ADR-versus-story conflict only when both opposing sentences are present and demonstrate
the incompatibility. An ungrounded suspicion is an assumption, not a recorded conflict; verify it
against the ADR and story text or report it as an assumption under the `/verify-claims` protocol.

Worked ADR-versus-story report:

```markdown
## Conflict: Session-based access contradicts token-only API story

**Stories involved:** Token-only API access vs ADR: Browser session authentication
**Files:** [.docs/stories/api-access.md] vs [.docs/decisions/adr-2026-08-10-browser-session-authentication.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-10-browser-session-authentication
**Story ID:** STORY-12
**ADR opposing sentence (verbatim):** "The API authenticates browser requests with server-side sessions."
**Story opposing sentence (verbatim):** "The API accepts only bearer tokens and does not create sessions."

**Description:** The same API requests cannot require server-side sessions while accepting only
bearer tokens and creating no sessions.

**Resolution Options:**
1. Amend STORY-12 to use the ADR's session mechanism.
2. Define an explicit session-and-token compatibility boundary.
3. Create a superseding ADR that selects token-only authentication.

**Recommendation:** Option 1 because it preserves the approved architectural decision.
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

**Accepted-artifact amendment:** When the resolution falsifies an assertion in an accepted
DECIDE artifact, perform the amendment during the DECIDE pass in that artifact — never defer it
as a later BUILD task. Add this note beside the original assertion:

```markdown
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

The amendment is additive: the original assertion remains; do not rewrite or delete it, and create
no separate record. This makes the correction part of the spec-branch baseline before
BUILD starts.

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
- [ ] ADR corpus read from `conflict_check.adr_corpus`, with `change_set` used when it is unset
- [ ] Selected approved ADRs from `.docs/decisions/` compared against relevant stories
- [ ] `repo_wide` scans record examined and narrowed-out ADRs; only this scope narrows the corpus
      or parses supersession status
- [ ] `repo_wide` excludes only unambiguously fully superseded ADRs and retains partial or
      ambiguous supersessions for comparison
- [ ] All 6 conflict types checked (contradiction, overlap, state, resource, sequencing, oscillating)
- [ ] Every pair sharing a behavior/entity/field/gate was tested in BOTH directions —
      "if A is fully satisfied, does B still hold?" — since one-directional checking
      cannot distinguish an oscillation from an ordinary contradiction
- [ ] Each conflict has severity, description, and resolution options
- [ ] User selected resolution for each blocking conflict
- [ ] Affected stories updated to reflect resolutions
- [ ] Conflict reports saved to `.docs/conflicts/`
- [ ] Re-check passed clean after resolutions
- [ ] Zero blocking conflicts remain before proceeding
- [ ] `.pipeline/review-required-conflict_check` marker written IF any conflict
      was found/resolved or degrading conflict was accepted (skip if truly clean)
