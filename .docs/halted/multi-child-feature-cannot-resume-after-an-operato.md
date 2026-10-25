# Halt record

Status: halted
Slug: multi-child-feature-cannot-resume-after-an-operato
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-multi-child-feature-cannot-resume-after-an-operato
Head SHA: 397da7cfcf105c28c3407aafe0a046bbdfc2e375
Halted at: 2026-10-25T07:57:22.472Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — S6.2 (architectural-clarity: Verified (90%): the 90 added lines in src/conductor/test/fixtures/n1-golden/finish/git-probe-argv.golden are read-only `for-each-ref refs/heads/feat` / `refs/conductor/n1-golden/` probes from hasDurableChildState, called by verifySlicePositions inside loadSliceTopology (slice-topology.ts:211) for every cardinality, unsliced plans included. ADR adr-2026-10-23-slice-topology-from-sealed-plan decision 3 requires the position comparison whenever child state exists, and defines child state to include child branches and closure refs. Detecting those from a recreated worktree with no .pipeline/children needs exactly these git probes. The prior as-built finding 09ad605d:1 already rejected skipping the check for unsliced/singleton plans as a bypass. Task 17's done-when requires each retained golden to differ only by removed coverage_binding lines, and this golden records every git argv on the N=1 finish path. Any implementation that satisfies D3 therefore adds probes to this golden, and any implementation that keeps the golden byte-identical reopens the D3 bypass. The only other option is routing the probe around the recorded runner, which would game the fixture. This has run 2 laps on prd_audit and 2 on architecture_review_as_built without converging. A human must choose: (a) amend Task 17's preservation contract to allow read-only durable-child-state probes in N=1 git-probe goldens, possibly deduplicated to one probe pair; or (b) narrow D3's durable-state detection for unsliced plans. That is a decision between two approved constraints, not a code change BUILD can make.); as-built:9f3d9ae6-0358-495f-9b16-6ef52ff1223b:1 (architectural-clarity: Same surface and cause as S6.2: git-probe-argv.golden:3 gains 90 read-probe lines because ADR decision 3, as enforced after as-built finding 09ad605d:1, requires durable-child-state detection (child branches, closure refs) for every plan cardinality. The finish path's recorded git runner captures that detection. Task 17 forbids any retained-golden change beyond coverage_binding step removal. The two approved constraints contradict each other on this fixture. Restoring the golden reintroduces the remediated D3 bypass, and keeping D3 violates Task 17. Two laps per gate have not converged. A human decision is needed to amend Task 17's golden-preservation clause (allow, optionally deduplicate, the read-only probes) or to narrow D3 for unsliced plans before BUILD can produce a correct fix.)
```
