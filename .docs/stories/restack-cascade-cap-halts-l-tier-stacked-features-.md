**Status:** Accepted

# Stories: Restack cascade cap is sized by the feature's complexity tier

Source: jstoup111/ai-conductor#3472. Track: technical (no PRD). Tier: M.

A stacked feature charges one cascade to the originating child each time a feature-repair restack
carries that child's change up the stack. Today every originating child halts `needs-human` after 3
cascades whatever the feature's tier, and Large stacked features hit that on ordinary repairs.
Operators then raise the cap without changing anything. These stories size the per-child allowance
by complexity tier (Small 3, Medium 3, Large 8, unrecorded treated as Medium), let operators
configure it per tier or for every tier, keep operator raises in control, and show the allowance
before it is exhausted. They build on #3475, after which a restack limit belongs to the originating
child in `refs/conductor/<slug>/cascades` and the cap evidence snapshots it. Counting only
"no-progress" cascades, removing the cap, and pinning the allowance at the first cascade are out
of scope.

## Story 1: An unconfigured stacked feature gets its tier's cascade allowance

**Requirement:** #3472 desired outcomes 1, 2, 4

As an operator, I want a Large stacked feature's originating children to get enough cascades for
an ordinary remediation cycle while Small and Medium features keep today's bound, so that routine
repairs do not halt and a child that never converges still does.

### Acceptance Criteria

#### Happy Path
- Given no config layer sets `stacked_prs.max_restack_cascades`, a stacked feature recorded at tier L, and a `cascades` ref charging originating child 1 with 7 cascades and no `limits` entry, when a feature-repair restack originating at child 1 runs, then no cascade-cap halt is written, the restack journal is created, and once the restack is applied child 1's count in the `cascades` ref is 8.
- Given the same unconfigured tier-L feature and a `cascades` ref charging child 1 with 3 cascades, when a feature-repair restack originating at child 1 runs, then it proceeds without a cascade-cap halt (the issue's observed halt at 3/3 no longer occurs for tier L).
- Given the same unconfigured repository and a stacked feature recorded at tier M whose `cascades` ref charges child 2 with 2 cascades, when a feature-repair restack originating at child 2 runs, then it proceeds and child 2's count becomes 3.

#### Negative Paths
- Given an unconfigured tier-L stacked feature whose `cascades` ref charges originating child 1 with 8 cascades and no `limits` entry, when a feature-repair restack originating at child 1 runs, then it halts with class `needs-human`, emits `restack_refused` with reason `cascade-cap` naming child 1, writes no restack journal, and child 1's count stays 8.
- Given an unconfigured stacked feature recorded at tier M whose `cascades` ref charges child 1 with 3 cascades, when a feature-repair restack originating at child 1 runs, then it halts with class `needs-human` and reason `cascade-cap` naming child 1, and no journal is written.
- Given an unconfigured stacked feature recorded at tier S whose `cascades` ref charges child 1 with 3 cascades, when a feature-repair restack originating at child 1 runs, then it halts with reason `cascade-cap` naming child 1.
- Given an unconfigured stacked feature with no recorded complexity tier whose `cascades` ref charges child 1 with 3 cascades, when a feature-repair restack originating at child 1 runs, then it halts with reason `cascade-cap` (treated as tier M, allowance 3), never allowance 8.
- Given a tier-L stacked feature whose `cascades` ref charges child 1 with 8 cascades and child 2 with 0, when a feature-repair restack originates at both children 1 and 2, then it halts naming child 1 and charges neither child.
- Given a tier-L stacked feature whose `cascades` ref holds a malformed blob, when a feature-repair restack runs, then it halts `needs-human` with reason `cascade-cap`, names the unreadable ref, and writes no journal.
- Given a base-refresh restack (not `feature-repair`) on a tier-M feature whose originating child already has 3 charged cascades, when the restack runs, then no cascade-cap check refuses it and no cascade is charged.

### Done When
- [ ] With no config set, the resolved per-child cascade allowance is S 3, M 3, L 8, and 3 for an unrecorded tier.
- [ ] A test drives an unconfigured tier-L feature through an 8th charged cascade on one child and a cascade-cap halt on the 9th, and an unconfigured tier-M feature to a halt on its 4th.
- [ ] No production source still defines or reads a single fixed restack cascade constant, and the stack preflight no longer performs a cap check whose result it discards.

## Story 2: Operators configure the cascade allowance per tier or for every tier

**Requirement:** #3472 desired outcomes 1, 4

As an operator, I want to set the cascade allowance once for every tier or separately per tier, so
that I can tune Large stacked features without loosening Small or Medium ones.

### Acceptance Criteria

#### Happy Path
- Given a project config setting `stacked_prs.max_restack_cascades: 5`, when the cascade allowance is resolved for features at tiers S, M and L and for a feature with no recorded tier, then each is 5 with source `configured`.
- Given a project config setting `stacked_prs.max_restack_cascades: { L: 10 }`, when the allowance is resolved, then a tier-L feature gets 10 with source `configured`, a tier-S feature 3, a tier-M feature 3 and a feature with no recorded tier 3, each of those three with source `default`.
- Given a user config setting `stacked_prs.max_restack_cascades: { M: 2 }` and a project config setting `stacked_prs.max_restack_cascades: { L: 6 }`, when the merged config resolves the allowance, then tier S gets 3, tier M gets 2 and tier L gets 6.
- Given a user config setting `stacked_prs.max_restack_cascades: { L: 6 }` and a project config setting `stacked_prs.max_restack_cascades: 4`, when the merged config resolves the allowance, then every tier gets 4.
- Given a tier-L stacked feature with `stacked_prs.max_restack_cascades: { L: 10 }` and a `cascades` ref charging child 1 with 9 cascades, when a feature-repair restack originating at child 1 runs, then it proceeds; with 10 charged it halts with reason `cascade-cap`.

#### Negative Paths
- Given a project config whose `stacked_prs` block sets `enabled: true` and `max_slices: 5` but not `max_restack_cascades`, and a user config that does not set it, when the config is loaded through the normal project-plus-user load path, then the loaded `stacked_prs` block has no `max_restack_cascades` key and a tier-L feature resolves allowance 8, never 3.
- Given a project config setting `stacked_prs.max_restack_cascades: 0`, when the config is loaded, then loading fails with an error naming `stacked_prs.max_restack_cascades` and stating it must be a positive integer or a map of S, M, L to positive integers.
- Given a project config setting `stacked_prs.max_restack_cascades: { XL: 9 }`, when the config is loaded, then loading fails with an error naming `stacked_prs.max_restack_cascades.XL` as an unknown tier.
- Given a project config setting `stacked_prs.max_restack_cascades: { L: 7.5 }`, when the config is loaded, then loading fails with an error naming `stacked_prs.max_restack_cascades.L` and stating it must be a positive integer.
- Given a project config setting `stacked_prs.max_restack_cascades: "8"`, when the config is loaded, then loading fails with an error naming `stacked_prs.max_restack_cascades`; the string is never coerced to a number.

### Done When
- [ ] `stacked_prs.max_restack_cascades` accepts a positive integer or an S/M/L map of positive integers, and each invalid shape is refused at load with a path-named error.
- [ ] A load-path test with a user and a project config proves per-tier map merging, integer-replaces-map, and that an unset key stays absent after loading.
- [ ] The config consumer registry names the module that reads `stacked_prs.max_restack_cascades`.

## Story 3: A cascade raise is measured against the tier allowance and keeps precedence

**Requirement:** #3472 desired outcomes 1, 2

As an operator recovering a cascade-cap halt, I want the raise to start from the allowance the halt
measured against and to win over the tier default afterwards, so that recovery works exactly as it
does today, only less often.

### Acceptance Criteria

#### Happy Path
- Given an unconfigured tier-L stacked feature halted on the cascade cap for originating child 1 at 8/8, when the operator runs `kickback-budget raise --gate restack --child 1 --by 2` with a rationale, then the raise is accepted, the authorized adjustment records before limit 8 and after limit 10, and the `cascades` ref's `limits` entry for child 1 becomes 10.
- Given that raise has been applied and the halt cleared, when a feature-repair restack originating at child 1 runs with 8 charged, then it proceeds without a cascade-cap halt; with 10 charged it halts again naming child 1 at 10/10.
- Given a tier-L stacked feature whose `cascades` ref holds `limits` entry 5 for child 1 (written by an operator raise) and no configuration, when a feature-repair restack originating at child 1 runs with 5 charged, then it halts on the cascade cap at 5/5; the raised per-child limit takes precedence over the tier default of 8.
- Given an unconfigured tier-M stacked feature halted on the cascade cap for child 2 at 3/3, when the operator runs `kickback-budget reset --gate restack --child 2` with a rationale, then the reset is accepted with before limit 3 and child 2's count in the `cascades` ref becomes 0.

#### Negative Paths
- Given a tier-L stacked feature halted on the cascade cap for child 1 at 8/8 after an earlier raise for child 2 to limit 5, when the operator raises child 1 by 2, then the raise is accepted with before limit 8, and child 2's `limits` entry stays 5 (one child's raise never changes another child's limit).
- Given a tier-M stacked feature halted on the cascade cap for child 1 at 3/3, and the project config is then edited to `stacked_prs.max_restack_cascades: { M: 4 }`, when the operator runs `kickback-budget raise --gate restack --child 1 --by 1`, then the raise is refused because the live cap evidence no longer matches the current allowance, the `cascades` ref is unchanged, and no resume authorization is installed.
- Given a crash after the adjustment was authorized but before the `cascades` ref update, when a `kickback-budget` command is re-run for that feature, then reconciliation at command entry applies the adjustment against the same tier-resolved default limit, and the ref's limit for that child is updated exactly once.

### Done When
- [ ] The restack raise/reset path, its crash reconciliation and the `cascades` ref compare-and-swap all resolve the absent-limit default through the same tier allowance the halt used.
- [ ] A test raises a tier-L cascade-cap halt from 8 to 10 and proves the resumed restack proceeds at 8 and halts at 10.
- [ ] A test proves a raise for one originating child leaves every other child's `limits` entry unchanged.

## Story 4: The cascade allowance is visible before and at exhaustion

**Requirement:** #3472 desired outcomes 2, 3

As an operator, I want the halt, `kickback-budget inspect` and `daemon status` to show each
originating child's consumed and limit with the tier allowance behind it, so that I can see a
feature approaching its cascade limit and know why a halt fired.

### Acceptance Criteria

#### Happy Path
- Given an unconfigured tier-L stacked feature halted on the cascade cap for child 1 at 8/8, when the halt is written, then its detail contains `originating child 1 reached 8/8 cascades — tier L allowance 8 (default)` and the existing `Kickback budget (restack): 8/8 consumed; 0 remaining` line.
- Given a tier-L stacked feature whose `cascades` ref holds `limits` entry 10 for child 1 and charges it with 10, when the cascade-cap halt is written, then its detail contains `originating child 1 reached 10/10 cascades — tier L allowance 8 (default); raised to 10`.
- Given a tier-M stacked feature with `stacked_prs.max_restack_cascades: { M: 4 }` halted at 4/4 for child 2, when the halt is written, then its detail contains `— tier M allowance 4 (configured)`.
- Given an unconfigured, not halted, tier-L stacked feature whose `cascades` ref charges child 1 with 4 and child 2 with 3, when the operator runs `kickback-budget inspect --feature <slug>`, then the output contains a `Restack cascades — tier L allowance 8 (default)` line followed by `child 1: 4/8 consumed; 4 remaining` and `child 2: 3/8 consumed; 5 remaining`.
- Given the same feature, when the operator runs `kickback-budget inspect --feature <slug> --format json`, then the JSON has a `restackCascades` object with `tier` `L`, `allowance` 8, `source` `default`, and `children` entries `{ child: 1, consumed: 4, limit: 8, remaining: 4, raised: false }` and `{ child: 2, consumed: 3, limit: 8, remaining: 5, raised: false }`.
- Given the same feature in progress, when the operator runs `daemon status`, then it prints `RESTACK CASCADES [<slug>]: tier L allowance 8 (default); child 1 4/8, child 2 3/8`.
- Given a tier-L stacked feature whose child 2 has a raised `limits` entry 10 and 3 charged cascades, when inspect and `daemon status` render it, then inspect shows `child 2: 3/10 consumed; 7 remaining (raised)` and status shows `child 2 3/10 (raised)`.

#### Negative Paths
- Given a tier-L stacked feature whose `cascades` ref does not exist yet, when inspect and `daemon status` render it, then inspect shows the `Restack cascades — tier L allowance 8 (default)` line followed by `none charged`, and status shows `RESTACK CASCADES [<slug>]: tier L allowance 8 (default); none charged`.
- Given a stacked feature with no recorded complexity tier, when inspect renders its cascades, then the line reads `Restack cascades — tier unrecorded, treated as M; allowance 3 (default)`, and the JSON `tier` is `null`.
- Given a stacked feature whose `cascades` ref holds a malformed blob, when inspect runs, then it prints `Restack cascades: unavailable (` followed by the ref's diagnostic, still renders the other gates, and exits 1; `daemon status` prints `RESTACK CASCADES [<slug>]: unavailable (` with the diagnostic and continues with the next feature.
- Given a feature that is not stacked (no child state), when inspect and `daemon status` render it, then neither prints any `Restack cascades` or `RESTACK CASCADES` line, and inspect's output is otherwise unchanged.

### Done When
- [ ] The cascade-cap halt, inspect (human and JSON) and `daemon status` render the tier label, allowance and source through one shared formatter.
- [ ] Tests assert the exact halt detail for the default, configured, raised and unrecorded-tier cases, and the exact inspect lines, inspect JSON and status line for the default, raised, missing-ref and malformed-ref cases (plus the unrecorded tier on inspect).
- [ ] A non-stacked feature's inspect and status output contain no cascade lines.
