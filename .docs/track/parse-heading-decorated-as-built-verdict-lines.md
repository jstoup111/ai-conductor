# Track: Parse heading-decorated as-built verdict lines

Track: technical

Scope boundary: Small fix for #2203, approved by the operator on 2026-09-06 (delegated). Widen the
as-built review's `Verdict:` line reader so a markdown heading and/or bold decoration around an
otherwise recognized verdict is read as that verdict, and route every engine reader of that line
through the one widened reader. The closed verdict vocabulary, the fail-closed diagnostics for an
absent or unrecognized verdict, the `Outcome delivered:` line (owned by #2175), the blocking-findings
table contract, and the reviewer prompt's canonical plain-line template all stay as they are.

This is an engine parser correction with no product requirement behind it; acceptance criteria live
in technical stories rather than a PRD.

The operator approved parser tolerance over pinning the plain form harder in the reviewer prompt on
2026-09-06 (delegated). The reviewer prompt already prescribes the plain line and the reviewer
decorated it anyway; a prompt cannot reach the parser, and the sibling report on the same artifact
(#2175) shows the same class recurring, so the durable fix is machinery on the reading side.

Scope check: A — consumer-facing (Step 1 fired no repo-only signal; a repository with no daemon, no
`.docs` history, and no self-host build still runs the as-built gate and still halts on a decorated
verdict line, so Step 2 answers YES); B — n/a (no new skill); C — provider-agnostic (a pure string
reader with no host-specific path, variable, or capability). No catalog registration is required and
no behavioral rule changes, so neither the consumer rule file nor the repo-only rule file is touched.

Verified foundation: `readAsBuiltVerdictLine` in `src/conductor/src/engine/artifacts.ts` matches only
optional leading horizontal whitespace and bold markers before `Verdict`, so an ATX heading prefix
falls through to `{ found: false }` and `classifyAsBuiltReviewOutcome` returns the `no-verdict-line`
invalid cause that halts the validation group. Two further readers of the same line carry their own
narrower regexes: the blocked-findings halt renderer in `src/conductor/src/engine/conductor.ts` and
the delivered-`PLAN_GAP` shipment finding reader in
`src/conductor/src/engine/shipment-association.ts`. The reviewer template in
`skills/architecture-review/SKILL.md` already prescribes the undecorated line, and the reference
documentation describes the requirement only as "a `Verdict:` line", which stays true after the
widening.
