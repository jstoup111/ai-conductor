# Conflict Check: Enforce the documented source layer directions (#1017)

**Date:** 2026-10-12
**Stories checked:** `.docs/stories/break-the-engine-ui-import-cycle-and-stop-types-im.md`, Stories 1–5, against the
existing `.docs/stories/` corpus and the approved ADRs.
**Result:** PASSED after resolution. One blocking conflict was resolved and no degrading conflicts
remain.

## ADR corpus

**Examined.** These overlap this spec's subject: layering, the event emitter, plugin registration,
provider construction, and `types/`:
- `adr-2026-10-07-conductor-decomposition-target-architecture`
- `003-ui-renderer-plugin-point`
- `002-plugin-manifest-and-discovery`
- `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-014-otel-observability-exporter`
- `adr-2026-07-26-event-sink-registry-exhaustiveness`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine`
- `adr-2026-10-12-enforced-source-layer-directions`

**Narrowed out.** The remaining approved ADRs. They govern step gates, rebase, intake, verdicts,
and self-host behaviour, and none of them addresses import direction, module location, or the
emitter's dispatch semantics. The other event-spine ADRs, such as audit trail and halt events,
cite `ui/events.ts` only as a code location in their context. Their decisions concern what rides
the spine, and the relocation keeps that unchanged.

## Conflict: A second layering checker competes with the approved D5 ratchet

**Stories involved:** Story 1 (as first drafted) vs ADR: Conductor decomposition target architecture
**Files:** [.docs/stories/break-the-engine-ui-import-cycle-and-stop-types-im.md] vs [.docs/decisions/adr-2026-10-07-conductor-decomposition-target-architecture.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-07-conductor-decomposition-target-architecture
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Today's violations are allowlisted as **one file per allowed edge**."
**Story opposing sentence (verbatim):** "Given the final `src/conductor/src/` tree, when the default Vitest tier runs the layer-direction structural test, then it passes with no allowlist and reports a non-zero count of scanned source files."

**Description:** D5 assigns layering enforcement to a single TypeScript-AST ratchet with a keyed,
shrink-only allowlist. That ratchet also detects value cycles inside a layer. D7 schedules it as
slice 2 (#1988), before slice 3, which is #3042 together with #1017. The drafted Story 1 and
ADR-2026-10-12 D6 built a separate checker with no allowlist and no intra-layer cycle detection. That
gives two enforcement mechanisms for one rule, and runs the roadmap out of order. The root cause
was in the design: the first pass of architecture-review missed the governing ADR.

**Resolution Options:**
1. Become slice 3. Depend on #1988, extend its upward rule to type-only edges, and empty its
   upward-edge allowlist.
2. Absorb slice 2 by building the D5-conformant ratchet in this feature. This widens scope.
3. Supersede D5 with a no-allowlist, upward-only checker.

**Recommendation:** Option 1 because it preserves the approved roadmap and a single checker.

**Resolution (operator, 2026-10-12):** Option 1. ADR-2026-10-12 was revised in place, since it is
not yet on main. It now reuses ADR-2026-10-07 D5 and D7, and its D6 extends the #1988 ratchet. The
architecture review, diagram, track scope boundary, and Story 1 were updated to match. The spec
lands with `--depends-on jstoup111/ai-conductor#1988`.

## Re-check

- **Story-versus-story.** Stories 1–5 are pairwise compatible. Stories 2–5 each remove a class of
  upward edge, and Story 1 asserts that none remains. In both directions, satisfying one story
  never re-breaks another.
- **Against the existing corpus.**
  - `decompose-conductor-ts-god-class-target-architectu` (slice 1, shipped) moved declarations
    within `engine/`. It does not contradict the emitter or provider moves.
  - `wave-c-json-stdout-subscriber` and the `ui_renderer` stories keep their renderer contract,
    because ADR-003's interfaces are unchanged.
  - No oscillation was found: no gate pair whose satisfaction re-breaks the other.
- **Against the ADRs.**
  - `003` D4 says `TerminalRenderer` registers as `ui_renderer:terminal` via the loader. It still
    does, from entry-level composition (Story 3).
  - `adr-2026-09-24` D3 has discovery run before `registerBuiltins` in both boot paths. Story 3
    keeps both boot paths and their order.
