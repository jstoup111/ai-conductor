**Status:** Accepted

# Stories: Architecture review never checks seam conformance (#1995)

Track: technical

Tier: S

Accepted 2026-11-15 (delegated by the operator). Terms used below: an *external system* is anything outside the consuming project's own code that its production code reaches — a hosted API, another service, a database or queue, a model provider, or a command-line tool run as a subprocess. A *seam* is a boundary interface that an APPROVED ADR of the consuming project designates as the way its production code reaches a named external system. The seam inventory is derived only from the consuming project's APPROVED ADRs; DRAFT and SUPERSEDED ADRs define no seam. Mechanical import-direction and layering rules stay with the project's linter (#1988) and are not judged by this check.

Criteria are stated at the policy layer: each one says what the `architecture-review` skill text directs the reviewer to do, because the engine delivers that skill to the reviewer unchanged and a unit test cannot run a real reviewer model. Live judgement is observed at SHIP, not asserted by a wording test.

## Story 1: The pre-stories review blocks a design that bypasses an approved seam

As an operator relying on architecture review, I want the DECIDE-time review to catch a proposed design that reaches an external system around the boundary my ADRs define, so that seam erosion is stopped before stories and code exist.

### Acceptance Criteria

#### Happy Path

- Given the `architecture-review` skill's Architectural Alignment section, when the pre-stories review (full or Medium lightweight) assesses a proposed design whose new production code reaches an external system directly while an APPROVED ADR defines a seam for that system, then the skill directs the review to record a blocking issue naming the external system, the governing ADR stem and decision, and the bypassing design element, and to issue a BLOCKED verdict.
- Given the `architecture-review` skill's Architectural Alignment section, when the proposed design reaches the external system through its approved seam, extends the seam's own implementation, or introduces a new boundary together with the ADR this review drafts for it where that system has no approved seam or that ADR supersedes the seam ADR, then the skill directs the review to record no seam-conformance blocking issue for that call.

#### Negative Paths

- Given the `architecture-review` skill's Architectural Alignment section, when no APPROVED ADR of the project defines a seam for the external system the design reaches, including a project with no APPROVED ADR at all, then the skill directs the review to record no seam-conformance blocking issue and not to infer a seam from existing code or from DRAFT or SUPERSEDED ADRs.
- Given the `architecture-review` skill's Architectural Alignment section, when the only concern is an import-direction or layering rule between the project's own modules with no external system reached, then the seam-conformance instructions leave that concern to the project's linter and raise no seam finding for it.

### Done When

- [ ] The Architectural Alignment section of `skills/architecture-review/SKILL.md` carries a seam-conformance block stating the blocking direction, the conforming directions, the no-seam and DRAFT/SUPERSEDED exclusions, and the linter boundary.
- [ ] The skill's Verification checklist carries a seam-conformance item for the pre-stories pass.

## Story 2: The as-built review blocks shipped code that bypasses an approved seam

As an operator relying on the SHIP gate, I want the as-built review to catch shipped code that reaches an external system around an approved seam, even when the feature's plan never cited that seam's ADR, so that a bypass that slipped through DECIDE, or was never reviewed at DECIDE (Small tier), still cannot ship.

### Acceptance Criteria

#### Happy Path

- Given the `architecture-review` skill's As-Built Compliance Gate section with `adrCompliance` on, when the reviewed diff adds production code, or reroutes existing production code, so that it reaches an external system directly while an APPROVED ADR defines a seam for that system, whether or not the plan cites that ADR, then the skill directs the reviewer to issue a BLOCKED verdict whose findings report every bypassing site with its `file:line`, governed by that seam ADR's decision as `<adr-stem> D<n>`.
- Given a BLOCKED seam-bypass finding in the as-built review, when the existing seam already offers what the call needs, then the skill classifies the finding `REMEDIABLE` with the seam ADR decision as its governing reference.
- Given a BLOCKED seam-bypass finding in the as-built review, when complying needs a new or changed boundary decision, then the skill classifies the finding `DESIGN` with the seam ADR decision as its governing reference.
- Given the `architecture-review` skill's As-Built Compliance Gate section with `adrCompliance` on, when the diff's new external-system calls all go through an approved seam, sit inside the seam's own implementation, or go through a new boundary whose APPROVED ADR is part of the same change and either covers a system no other APPROVED ADR gives a seam or supersedes that seam ADR, then the skill directs the reviewer to raise no seam-bypass finding.

#### Negative Paths

- Given the `architecture-review` skill's As-Built Compliance Gate section, when `adrCompliance` is off for the run, then the skill directs the reviewer not to run the seam-conformance sweep and to raise no seam-bypass finding.
- Given the `architecture-review` skill's As-Built Compliance Gate section, when no APPROVED ADR defines a seam for an external system the diff reaches, then the skill directs the reviewer to raise no seam-bypass finding for that call.
- Given the `architecture-review` skill's As-Built Compliance Gate section, when the diff adds or reroutes no production call that reaches an external system, or does so only in test code or fixtures, then the skill directs the reviewer to treat the seam sweep as satisfied without searching the ADR corpus for seams.

### Done When

- [ ] The As-Built Compliance Gate scope list of `skills/architecture-review/SKILL.md` carries a seam-conformance sweep stating the blocking sweep, the conforming directions, the `adrCompliance`-off, no-seam, and test-code exclusions, and the diff-first bound.
- [ ] The as-built classification table and the Verification checklist each carry the seam-bypass entries.

## Story 3: The seam check stays project-agnostic

As a consumer project installing the harness, I want the seam-conformance instructions to describe how to find my project's seams rather than name the harness repository's own, so that the check applies to my boundaries and is silent where I have defined none.

### Acceptance Criteria

#### Happy Path

- Given the `architecture-review` skill's seam-conformance instructions in both passes, when a consuming project's review reads them, then they direct the reviewer to derive the seam inventory from that project's own APPROVED ADRs in its decisions directory.

#### Negative Paths

- Given the `architecture-review` skill's seam-conformance instructions in both passes, when they are read, then they name no source file path, source file extension, module name, port name, or boundary interface name belonging to any particular repository.

### Done When

- [ ] Both seam-conformance passages derive the inventory from the project's own APPROVED ADRs and name nothing that belongs to a particular repository.
