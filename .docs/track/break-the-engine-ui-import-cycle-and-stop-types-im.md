# Track: Enforce the documented source layer directions (#1017)

Track: technical

Change class: refactor

Scope boundary: Comprehensive layering. Make `src/conductor/src/` obey the documented one-way chain `types ← execution ← engine ← ui ← entry points`: break the `engine/` ↔ `ui/` cycle (relocate `ConductorEventEmitter` out of `ui/`; move `engine/plugin-loader.ts`'s terminal subscriber/renderer wiring out of `engine/`), remove every `execution/` → `engine/` import, make `types/` import nothing from `execution/`, `engine/`, or `ui/` (type-only imports included), enforce it through the #1988 import-graph ratchet (adr-2026-10-07-conductor-decomposition-target-architecture D5), extending its upward-edge rule to type-only imports and emptying its upward-edge allowlist (this spec is that ADR's roadmap slice 3 and depends on #1988), and refresh the "Dependency direction" section of `docs/contributing/code-organization.md` to the enforced reality. Excluded: no new layer directory; no behavior change; no restructuring inside a layer beyond what an edge fix requires; `tools/` and entry-point files keep their current permitted edges.

Rationale: the issue's cycle is mostly one misplaced module (`ui/events.ts` holds the event-spine emitter), and the operator chose to fix all upward edges including the unreported `execution/` → `engine/` drift. Approved approach: relocate code to match the documented layering, enforced by a TS-compiler-API import test. Rejected: a new `core/` foundation layer (adds a sixth layer and a dumping-ground judgement; fallback only if planning finds shared helpers do not fit `execution/`); a shrinking allowlist ratchet (leaves the cycle in place, below the confirmed scope).
