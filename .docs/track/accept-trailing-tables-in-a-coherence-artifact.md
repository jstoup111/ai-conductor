# Track: Accept trailing tables in a coherence artifact

Track: technical

Scope boundary: Small fix for jstoup111/ai-conductor#1979, approved by the operator on 2026-09-06
(delegated). Widen the shared coherence parser so a complete, well-formed mapping table is accepted
regardless of what follows it, keep every mapping row loud rather than silently dropped, and leave
every currently-accepted artifact parsing to identical rows. The verdict vocabulary, cell grammar,
row classes, failure reason ids, waiver mechanism, and the semantic layers that run after parsing
are outside this slice.

This is an internal parser correction to a machine-consumed artifact grammar; acceptance criteria
live in technical stories rather than a PRD.

Approach decision, approved by the operator on 2026-09-06 (delegated): of the two hypotheses on the
issue, "keep the restriction and only improve the diagnostic" is discarded because it contradicts
the issue's first desired outcome, which requires the artifact to pass. The chosen approach widens
the parser but refuses to trade a loud failure for a silent drop: the first table stays the mapping
table and is parsed exactly as strictly as today; a later table is parsed as mapping content when
its first data row is a mapping row; any other later table is ignored, and a mapping row found
inside one of those ignored tables is rejected with a message naming the rule.

No ADR is written or amended. `adr-2026-08-26-shared-coherence-parser-at-discovery` is the
governing decision and its 2026-08-28 amendment already routes this exact question here by name
("Widening the parser to tolerate trailing tables ... is tracked separately as
jstoup111/ai-conductor#1979 and deliberately not decided here"). That ADR's restated obligation 4
requires no silent loss — every artifact the retired discovery predicate accepted must be either
eligible at discovery or blocked with an actionable diagnostic. Widening strictly reduces the
blocked half of that disjunction and adds no silent loss, so the obligation is strengthened, not
altered, and no amendment is owed.

Scope check: A — consumer-facing (no repo-only signal fires; the shared parser is engine code that
every installed harness runs at land and at discovery, and a consumer repository with no daemon and
no self-host history benefits identically); B — n/a (no new skill); C — provider-agnostic (pure text
parsing, no provider path, variable, or capability). Registration required: the canonical
consumer-facing documentation page for artifact shapes, updated in the same change.

Verified foundation: `src/conductor/src/engine/coherence-parse.ts` treats the first pipe-delimited
line in the whole file as the mapping table header, requires the next such line to be a separator,
and then treats every remaining pipe-delimited line in the file as a mapping row, so a second
table's header and separator arrive as data rows and are rejected. Three call sites share that one
function — the land gate (`coherence-validator.ts:1591`, which surfaces the failure reason plus the
`line`/`message` detail), daemon discovery (`daemon-backlog.ts:998`, which blocks a non-S spec as
`missing-coherence` with the same detail in its remedy), and the coverage-binding input assembler
(`coverage-binding-inputs.ts:31`, which degrades to zero criterion claims) — so a single parser
change keeps all three surfaces in agreement by construction. `skills/coherence-check/SKILL.md:81`
already documents "a Markdown table (or one table per row class)", a shape the current parser
rejects; this change makes the implementation match the contract it already publishes.
