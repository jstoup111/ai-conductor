# Track: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

Track: technical

Scope boundary:

The governing decision already exists and is APPROVED:
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — "DECIDE mutates the artifact
itself. DECIDE never emits a task that mutates a DECIDE artifact." Its §4 orders exactly the
enforcement this feature repairs: a deterministic, mechanical (never LLM-judged) check at
authoring time and again at land. This feature does not change that decision; it closes the
holes through which a violating plan still passed.

The same wrong rule is written in three places, and all three are fixed together:

IN SCOPE
1. Engine — `scanPlanProtectedTargets` (`plan-protected-targets.ts:26-35`) scans a task's
   `**Files:**` paths OR its body prose, never both, so any task declaring a `**Files:**` line has
   its prose skipped entirely. This is the incident. Union the two scans.
2. CLI — `cli.ts:433` tells the author to add a `**Files:**` line, which is precisely what
   silences the prose scan. An author following the tool's own advice hides the violation.
3. Skill — `skills/plan/SKILL.md:143-147` states the prohibition over the `**Files:**` set only
   and omits `.docs/decisions/`. Extend it to any reference in the task body and add the missing
   directory.
4. ADR — the governing ADR's §3 says "the four sealed directories only" and omits
   `.docs/decisions/`, while `PROTECTED_ARTIFACT_DIRECTORIES` has five. Amend in place using the
   ADR's own codified dated-note form (§1), which is DECIDE amending an accepted artifact exactly
   as that ADR prescribes.
5. An operator runbook for recovering a build that already hit an unsatisfiable
   protected-artifact plan task.

OUT OF SCOPE (each with the reason)
- Detecting a prose reference that names a protected artifact but carries no path at all. Never
  observed — the incident's ADR was a foreign artifact that the item-1 union catches on its own —
  and it is the only candidate carrying false-positive risk on a gate that fronts every
  `engineer land` in every consumer repository. Naive marker matching flags 35 of 112 unshipped
  plans (31%); a gate that spuriously blocks a third of lands trains authors to route around it,
  which is precisely how this defect was created (item 2). The architecture review records the
  measurement.
- A plan-declared bypass marker for a genuinely-needed protected amendment. The governing ADR
  rejects this mechanism by name: "Loosen the seal — tolerate any amendment the plan explicitly
  declares. Rejected: it converts the seal from tamper detection into a declaration checkbox, and
  any BUILD session that can write a plan can write itself the permission." Its §5 accepts the
  consequence deliberately: "a residue that needs a human is acceptable where a bypass is not."
  The runbook (item 6) carries that recovery instead.
- Dropping the `namesOwnFeature` exemption. NOT a defect. `protected-artifact-seal.ts:1000`
  collects own-feature drift as `selfAmendments` and returns `ok: true`; `conductor.ts:6092` only
  logs a notice. The ADR's §3 states the exclusion is deliberate: "Banning own-feature paths would
  break shipped machinery to solve a problem it does not have."
- Build-dispatch-time re-validation. Measured exposure across all 112 unshipped plans on main is
  effectively zero (2 hits: 1 already caught at land by today's scanner, 1 a docs-example glob),
  and the ADR states enforcement is "at authoring and land, not retroactive over merged plans."
- A completeness/reseal evidence join and the kickback-budget change. Both belong to #1629 (spec
  merged; build in flight as PR #1734).

Rationale: an internal authoring gate, an engine parser, skill prose, and an operator runbook — no
user-facing product capability, so acceptance criteria live directly in stories and no PRD is
authored.
