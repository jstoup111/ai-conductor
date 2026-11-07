# Conflict Check: Enforce module layering with the import-graph ratchet (#1988)

**Date:** 2026-10-24
**New stories:** `.docs/stories/module-layering-is-prose-only-violations-merge-wit.md` (Stories 1–4)
**Result:** Passed. There are 0 blocking conflicts and 1 degrading conflict, which the operator
accepted.

## Inventory

There are 626 story files under `.docs/stories/`. They were narrowed to the ones that assert
import-graph, layer-direction or import-cycle behavior, or the conductor import guard:

- `break-the-engine-ui-import-cycle-and-stop-types-im.md` (slice 3). It is compared pair by pair below.
- `decompose-conductor-ts-god-class-target-architectu.md` (slice 1). Its `conductor.js` importer
  restriction and shim criteria are enforced by `checkConductorImports`, which this spec leaves
  unchanged. The new Story 4 treats shim re-exports as ordinary same-layer edges. If either side is
  fully satisfied, the other still holds. Clean.
- `guard-module-headers-that-claim-no-callers-against.md`. Its header-claim guard resolves imports
  with private helpers inside its own test file. It shares no resource or rule with the ratchet.
  Clean.
- `coherence-artifact-passes-engineer-land-then-block.md`. Its one import-graph assertion scopes a
  single extracted module and does not interact with the ratchet. Clean.
- `2026-07-12-wiring-reachability-gate.md` and `per-task-wired-into-contracts-cost-build-cycles-th.md`.
  These cover reachability from entry points. The first uses "Layer" in an unrelated sense, and the
  second retired the reachability import walk. They do not interact. Clean.

There are 729 decision files. They were narrowed to the ADRs whose subject is import direction or an
import-graph check:

- **Examined:**
  - `adr-2026-10-07-conductor-decomposition-target-architecture` (APPROVED; D5, D7)
  - `adr-2026-10-12-enforced-source-layer-directions` (APPROVED; D1, D6)
  - `adr-2026-07-30-contract-aware-same-file-wiring` (APPROVED). It concerns wiring proof, not layering.
  - `adr-2026-07-12-wiring-check-gate`. It is retained because its supersession is partial. Its
    import graph serves reachability, and the build_review wiring rubric that consumed it has since
    been retired.
- **Narrowed out:** every other ADR, because none decides import direction, import cycles or a
  layering check.

ADR comparisons:

- **D5 against Stories 1–3.** D5 requires the check to fail on any new value-import cycle or upward
  value edge, with a one-file-per-edge allowlist that fails on an edge that no longer exists.
  Stories 1–3 implement exactly that. Story 3 adds the operator-confirmed stale condition (no longer
  a violation), which D5's text does not forbid.
- **ADR-2026-10-12 D1 against Story 1.** The `tools/` and entry-point rules match D1 word for word.
- **ADR-2026-10-12 D6 against Story 1.** This pair is the degrading conflict below.

## Conflict: Slice 3 later reverses this slice's type-only and dynamic-import exemptions

**Stories involved:** Story 1 of `module-layering-is-prose-only-violations-merge-wit` vs Story 1 of `break-the-engine-ui-import-cycle-and-stop-types-im`
**Files:** [.docs/stories/module-layering-is-prose-only-violations-merge-wit.md] vs [.docs/stories/break-the-engine-ui-import-cycle-and-stop-types-im.md]
**Type:** sequencing
**Severity:** degrading
**ADR filename stem:** adr-2026-10-12-enforced-source-layer-directions
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "The ratchet's upward-edge rule is extended to type-only imports, re-exports and dynamic `import()`."
**Story opposing sentence (verbatim):** "Given a fixture in which an `engine/` file reaches a `ui/` module only through a dynamic `import()` call, when the checker evaluates it with an empty allowlist, then it reports no violation for that call."

**Description:**

- This spec's Story 1 accepts type-only imports and dynamic `import()` as non-violations of the
  upward rule. Those are its third and fourth happy-path criteria, S1.3 and S1.4.
- Slice 3's Story 1 later rejects the same forms as upward violations:
  - "a `types/` file has an `import type` from `engine/` … reports the edge as an upward violation"
  - "an `engine/` file calls dynamic `import()` on a `ui/` module … reports the dynamic import as an upward violation"
- The two never gate the same build:
  - Slice 3 depends on #1988, so this feature ships and is audited first.
  - Slice 3's task 14 then changes the upward rule and flips this spec's fixture tests.
- Until then the two stories cannot both be true of one checker, so this is not an oscillation.
  After slice 3 lands, this spec's S1.3 and S1.4 describe superseded behavior.
- This spec's cycle rule (Story 2) and allowlist rules (Story 3) are unaffected, because ADR-2026-10-12
  D1 leaves D5's value-cycle rule unchanged.

**Resolution Options:**
1. Keep both as written, and record that slice 3 supersedes S1.3 and S1.4 for the upward rule only.
   Slice 3's task 14 replaces the matching fixture assertions when it builds.
2. Drop S1.3 and S1.4, and pin the exemptions only through the edge definition in the stories file's
   preamble. That removes the stale criteria, but leaves this slice's exemption untested, so the seed
   allowlist could silently include type-only edges.
3. Fold slice 3's extension into this spec. That widens the scope the operator confirmed and runs the
   D7 roadmap out of order.

**Recommendation:** Option 1. The exemption is this slice's confirmed behavior and must be tested so
that the seed allowlist is correct. The reversal is already decided, sequenced and owned by slice 3.

**Resolution:** The operator accepted Option 1 on 2026-10-24. No story text changes.
