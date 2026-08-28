# Halt record

Status: halted
Slug: coherence-artifact-passes-engineer-land-then-block
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-coherence-artifact-passes-engineer-land-then-block
Head SHA: c3439ccd5ac520788c7ab2d3d045dbb17fe8c754
Halted at: 2026-08-28T05:24:26.964Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Need user decision: Story 2's sealed Done-when still requires every retired-predicate acceptance to stay eligible and only new-parser acceptances to diverge, while the approved ADR's 2026-08-28 amendment requires no silent loss and permits a `missing-coherence` block with actionable detail. Choose and approve either (1) reseal Story 2 to the ADR's no-silent-loss contract, then run rem-as-built-rem-adr-002, or (2) widen the parser (tracked by #1979) so the original eligibility contract holds.


stall:coherence-eligibility-contract (architectural-clarity: The question's DIRECTION is answerable from committed artifacts and the answer is option (1): the operator-approved amendment at commit 73bc1f465 restates ADR decision 4 (.docs/decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md:67-88) as no-silent-loss and explicitly forecloses option (2) — 'Widening the parser ... is tracked separately as jstoup111/ai-conductor#1979 and deliberately not decided here' — and the seal ledger (.pipeline/protected-artifact-seal.json rebaselines[1]) records that reseal's reason as exactly this conflict. Option (2) is therefore not selectable this lap. But the daemon still cannot proceed, because option (1) is only two-thirds executed and the remaining third is a protected-artifact edit no autonomous step may make: (a) .docs/stories/coherence-artifact-passes-engineer-land-then-block.md:50 Done-when still reads 'asserts every old-accepted fixture stays eligible, and that the only divergences are new-predicate acceptances (condition C-A)', the pre-amendment contract — the 8cbb2f835 reseal realigned Story 2's acceptance criterion (:38) and plan Task 6's Done-when (:190-191) but left this bullet behind; and (b) the appended plan task at .docs/plans/coherence-artifact-passes-engineer-land-then-block.md:254 (rem-as-built-rem-adr-002) directs the build to assert 'every oracle-accepted fixture remains eligible' and that the second-table class 'stays eligible via shipped/processed dedup rather than via the parser', which the amendment expressly forbids: 'Dedup skipping a counterexample before it reaches the parser does not discharge the obligation; the shape must be exercised in an un-deduped run.' Routing to build would make the governing task contract (skill sec.1) command ADR-violating work and re-raise AB-3 on the next as-built lap; acceptance_specs and architecture_review can neither reseal a protected artifact nor rewrite an appended plan task. Resolution is one operator TTY reseal covering both paths, restating (a) to 'asserts no old-accepted fixture is silently dropped: each is either eligible, or blocked with missing-coherence carrying a line-and-message remedy' and (b) to require the second-table fixture be run un-deduped and asserted blocked with missing-coherence plus the parser detail; after that reseal, rem-as-built-rem-adr-002 is ordinary build work inside existing Task 6 and needs no plan addition. Class sweep of every artifact still asserting the superseded unconditional framing: stories:50 and plan:254 (both above, both requiring the reseal); ADR decision 4 body :60-65 is superseded in place by the :67-88 amendment block and needs no further edit; the ADR blast-radius text :80-84 reasoning the six losing-direction divergences away via dedup is narrative measurement, not an obligation, and is left as-is; the non-blocking architecture-diagram drift at .docs/architecture/coherence-artifact-passes-engineer-land-then-block.md:4-5,14,33 is found and deliberately excluded here because it is a separate diagramDrift finding, not part of this eligibility contract. No emitted task removes, replaces, or relaxes existing code, tests, or assertions; no tasks are emitted.)
```
