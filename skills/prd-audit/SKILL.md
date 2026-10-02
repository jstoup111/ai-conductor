---
name: prd-audit
disable-model-invocation: true
description: "Use at SHIP to judge the shipped implementation against the feature stories' acceptance criteria, with PRD and plan intent as context. Produces graded, criterion-level findings; does not implement or route work."
enforcement: gating
phase: ship
standalone: true
requires: [verify-claims]
model: opus
---

## Purpose

At SHIP, judge whether the implementation was built as the feature stories specify. The stories'
acceptance criteria are the authority. PRD functional requirements are intent context when a PRD
exists; the plan's stated outcome is also intent context. This is a finding-authority: report
grounded judgement and do not implement, amend DECIDE artifacts, append remediation tasks, or choose
the gate route. The engine owns those mechanical outcomes.

Each finding carries exactly one grade: `PASS | FIXABLE | PLAN_GAP | OVER_SCOPE`. Verdict Table
findings are keyed to active story criteria; no-owner OVER_SCOPE findings are keyed as `NC.<n>` in
their dedicated section below. The engine rejects malformed rows with a diagnostic while retaining
valid sibling rows. Never invent a key (`OS.1`, `SCOPE.2`) or write duplicate rows for one key.

**Every Verdict Table key must be an id of an active story criterion.** Use the form
`S<story>.<criterion>`; do not use `NC.<n>` in the Verdict Table. A well-formed story key that
names no criterion in the active stories is also invalid.

`<story>` is the story's heading id verbatim, not just its digits — `## Story 5a:` owns `S5a.1`,
`S5a.2`, … and `## Story 2.1:` owns `S2.1.1`, `S2.1.2`, …, each distinct from Story 5's and Story
2's. `<criterion>` is always the numeric ordinal. Keys are matched case-insensitively.

Per the `/verify-claims` protocol, cite concrete `file:line` evidence and give a confidence when
evidence is ambiguous. Do not turn uncertainty into a PASS.

Run at SHIP alongside the other SHIP validators. The configured step decides whether it is enabled;
this skill does not infer a skip from feature tier, track, or the absence of a PRD.

## Managed review

When the engine dispatches this skill, it supplies the bounded, versioned evidence projection and
the terminal native structured-result shape. Treat those as the complete machine contract. Judge the
supplied criteria against the supplied intent, change, task, and history evidence, then return one
terminal structured judgment that conforms to the supplied shape.

Do not recreate engine input collection, infer routing authority, or substitute a Markdown report
for the terminal judgment. Do not write `.pipeline/prd-audit.json`, `.pipeline/prd-audit.md`,
accepted-widening state, operator decisions, or any other verdict artifact. The engine validates,
persists, renders, and routes the returned judgment.

For every supplied criterion, return grounded evidence and rationale with exactly one allowed grade.
A FIXABLE judgment names exactly one supplied owner. An OVER_SCOPE judgment supplies its closed
intent relation. Use a no-owner observation only for an actual unowned OVER_SCOPE finding. Never
self-accept or refuse a finding.

## Standalone review

When a human invokes this skill outside the managed engine step, inspect the available stories, plan,
PRD, implementation, tests, and scope evidence and present a human-readable advisory judgment to
the operator. It is not current managed gate evidence. Do not write managed verdict artifacts or
operator-decision stores; the operator or engine owns any follow-up action.

**Delegated evidence gathering.** This audit runs late in a long session, and the auditor's own
context is what holds the verdict table. Push the reading into subagents through the host's
facility (Claude Code: the Agent tool; Codex: `collaboration.spawn_agent` / `collaboration.wait_agent`)
and keep the auditor's window for grading:

- One subagent per story (or per criterion cluster when a story is large). Each receives the
  story's criteria verbatim, the owning plan tasks, and the changed-file list, and returns a
  **digest**: per criterion, the evidence found (`file:line`, the test name, or the `Scope:`
  trailer), a candidate grade, and one sentence of rationale. Cap a digest at roughly two thousand
  words.
- The auditor never re-reads what a digest already quotes. It grades from the digests, re-opens
  only the lines needed to settle a disagreement, and owns every row of the Verdict Table.
- **Model tiers.** The auditor stays on this skill's pinned tier. Reading and extraction subagents
  run on the host's mid tier (Claude Code `model="sonnet"`; Codex uses its configured default).
  Step a subagent up to the auditor's tier only for adjudication of one contested criterion.
- Bound every read the subagents and the auditor make: read each artifact once; per-file
  `git diff <base>...HEAD -- <path>` with default context, never `--unified=80` or wider;
  `git log --oneline -n 30`; filter `rg` output by path before listing. Do not re-read
  the harness rules, `CLAUDE.md`, or this skill; they are already in context.

## Validator discipline (MUST — copy verbatim into every subagent brief)

Both rules below are operator rules on the auditor and on every subagent it delegates to. Include
them **verbatim** in each subagent brief; a subagent that never received them is not bound by them.

1. **Read-only evidence.** The validator and every subagent it delegates to MUST NOT execute tests,
   typecheck, lint, build, the integrity script, or any command that runs project code — including
   `vitest`, `npm test`/`npm run`, `npx`, `node -e` probes over project modules, and bash test
   scripts. Evidence is what the source and committed artifacts say: `file:line`, test names read
   from test source, `git diff`/`git log` output, and `Scope:` trailers. If a criterion cannot be
   judged without running code, grade it from the evidence available and say so in the rationale;
   never run it. The validator writes no managed verdict or operator-decision artifacts. Nothing is
   written, staged, or committed.
2. **Never yield with delegated work outstanding.** The validator MUST NOT end its turn while any
   subagent it spawned has not returned. Collect every digest before grading; if a subagent is slow,
   wait for it — do not summarize partial results and do not report progress in place of a verdict.

**Why.** Both rules exist to prevent a daemon halt class. Running project code from a validator
mutates the worktree the SHIP gates fingerprint; and ending the turn with subagents outstanding ends
the session in print mode, so the host's background-wait ceiling kills the pending subagents, no
verdict artifact is written, and the engine's freshness handshake HALTs the feature
(`post-dispatch verdict write handshake failed ... is stale`).

## Judge each criterion

For every story criterion, record one row.

- **PASS** — the shipped behavior satisfies the criterion. Cite the code and/or behavioral proof.
- **FIXABLE** — the criterion is unmet and an existing active-plan task owns the repair.
  **FIXABLE cites its owning plan task.** It also names the criterion it repairs; do not invent a
  task, and do not use this grade when the required work is outside the approved plan.
- **PLAN_GAP** — the criterion is unmet and no existing task owns its repair. Describe why the plan
  is insufficient. For a PRD requirement with no traced story criterion, make that missing coverage
  explicit as a PLAN_GAP rather than assessing the FR as though it were a criterion.
- **OVER_SCOPE** — shipped behavior goes beyond the planned implementation. Judge it against intent:
  PRD Goals/Non-Goals and In/Out Scope when available, otherwise the stories plus the plan outcome.
  State whether the widening is within intent, outside intent but not user-visible, or outside intent
  and user-visible. Include any `Scope:` trailer rationale and operator-reseal rationale in the
  evidence. A reseal rationale that does not justify the protected-artifact change is an OVER_SCOPE
  finding; a rationale that does justify it is evidence for no finding.
  **An unplanned change usually owns no story criterion.** Key the row to the criterion whose
  behavior the change actually affects when one exists. When none does, do not force it into the
  table or borrow an unrelated criterion's key. Report it under a `## Findings without an owning
  criterion` section below the table. Its first column is `Finding` and each row's first cell must
  be a unique `NC.<n>` key (for example, `NC.1`). `NC.<n>` keys belong only in this section, where
  every row must be `OVER_SCOPE`; do not use another grade. Give each no-owner finding exactly one
  row — duplicate `NC.<n>` keys are rejected. Include its judgement in Criterion detail as usual.
  **Use durable history as judgment context, never report text.** Before authoring a no-owner row,
  inspect the engine-rendered original decision history when present, then state the current evidence
  in your own words. Do not copy a stored summary, rationale, or `NC.<n>` ordinal into the report.
  Give the current finding an accurate current description and unique current key. The engine binds
  prior authority only after it reconciles immutable original evidence, current evidence, and case
  identity; a reviewer must never claim that wording alone proves the same behavior. If the relation
  is uncertain, describe the uncertainty and leave it unresolved.

Do not conflate grades: an unmet criterion with an existing owner is FIXABLE even if another
criterion is a PLAN_GAP. One row carries one grade.
