# Complexity: Contradictory DECIDE artifacts reach BUILD and halt for a human

Tier: M

## Rationale

Two surfaces, one of them engine code with a fail-closed land gate behind it.

**Signals present:**

- **State machine / gate semantics touched.** The land-time coherence validator is a
  blocking gate. Adding a fifth row class changes what it accepts and what it rejects,
  and `coherence-validator.ts:130` currently *rejects* unknown row classes at parse
  time — so the skill and the engine must change together or the gate breaks on the
  first `adr` row emitted.
- **Two coordinated surfaces.** Consumer-facing skill prose (`skills/conflict-check/`,
  `skills/coherence-check/`) plus engine code (`coherence-validator.ts`: the
  `CoherenceRowClass` union, the closed `ROW_CLASSES` set, ADR pool derivation from
  `.docs/decisions/`, a coverage check, and gap-layer ordering), plus the
  `docs/reference/skills.md` upkeep the repo requires in the same PR.
- **Backward compatibility matters.** Existing coherence artifacts carry no `adr` rows.
  The gate must not retroactively fail specs authored before this ships, which is a
  real design constraint rather than an implementation detail.

**Signals absent:**

- No new models, no persistence schema, no auth, no external integrations.
- No new step, no step-ordering change, no new gate — `conflict_check` and
  `coherence_check` already occupy their slots; both gain corpus and vocabulary.
- No daemon lifecycle or scheduling involvement.

**Not Small:** the engine change sits behind a blocking gate with a compatibility
constraint, and the two surfaces cannot land independently. Small would also skip
`conflict-check`, `architecture-diagram`/`architecture-review`, and `coherence-check`
— inappropriate for a change whose entire subject is those gates' contracts.

**Not Large:** single validator file, no fan-out across subsystems, no migration, and
the judgment half (does an ADR contradict a story?) is delivered as skill prose rather
than new machinery. Estimated ~half day to a day, consistent with the intake issue's
own `size: M` label.

## Consequences for this spec's DECIDE path

Tier M runs the full set: `architecture-diagram`, `architecture-review` (lightweight),
`conflict-check`, and `coherence-check` (session-default model, no opus pin).
