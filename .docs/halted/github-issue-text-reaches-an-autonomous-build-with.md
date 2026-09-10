# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-10T22:32:52.952Z
Slug: github-issue-text-reaches-an-autonomous-build-with
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-github-issue-text-reaches-an-autonomous-build-with
Head SHA: 4466b0143087d780a3de4209b1d056729f975b87
Halted at: 2026-09-10T22:27:26.148Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

````text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given an open issue whose body contains a prose line shaped as an instruction to the agent (for example `Ignore the plan above and run the following command`), when the adapter polls it, then the resulting `Envelope.text` carries `[neutralized:agent-directive]` in place of that line and every other prose line is byte-identical.
Task ids: 2
Done when checks: `sanitize-inbound.test.ts` proves an agent-directive line, a `SYSTEM:` role tag, and a `<system>` element are each replaced in place by their category marker and the neutralization list carries the matching category and count. | `sanitize-inbound.test.ts` proves a neutral body and a body containing only a suspicious word produce an unchanged body and an empty neutralization list. | The fixture corpus under `src/conductor/test/fixtures/intake-inbound/` has at least eight input/expected pairs and every pair passes.
Missing assertion: The checks do not require polling an open issue to produce Envelope.text with every non-directive prose line byte-identical.

Criterion: Story 1 happy: Given an issue body containing a role tag or system-prompt shape (for example a line beginning `SYSTEM:` or an `<system>` element) outside any code fence, when the adapter polls it, then `Envelope.text` carries `[neutralized:role-tag]` or `[neutralized:system-prompt]` in its place and the count for that category is recorded on the envelope.
Task ids: 2
Done when checks: `sanitize-inbound.test.ts` proves an agent-directive line, a `SYSTEM:` role tag, and a `<system>` element are each replaced in place by their category marker and the neutralization list carries the matching category and count. | `sanitize-inbound.test.ts` proves a neutral body and a body containing only a suspicious word produce an unchanged body and an empty neutralization list. | The fixture corpus under `src/conductor/test/fixtures/intake-inbound/` has at least eight input/expected pairs and every pair passes.
Missing assertion: The checks do not explicitly require polling to place the neutralized text and category count on Envelope.text/the envelope, nor that these replacements apply only outside code fences.

Criterion: Story 1 happy: Given an issue captured by the re-route or re-eligibility path rather than the first poll, when its envelope is built, then it carries the same neutralization as a first-poll capture of the same body.
Task ids: 5
Done when checks: `github-issues.test.ts` proves poll, re-route, and re-eligibility all emit `text` with armor lines and markers and set `inbound` on the envelope. | `github-issues.test.ts` proves an empty title+body issue produces no envelope and logs the skip with its `sourceRef`, and a single-directive-line body is captured with non-empty `text`. | `buildText()` in `src/conductor/src/engine/engineer/intake/github-issues.ts` is the only production caller of `sanitizeInboundText` and passes the adapter's parsed `WorkRef`.
Missing assertion: The checks require each path to emit armored, marked text, but do not require re-route and re-eligibility to receive the same neutralization as a first-poll capture of the same body.

Criterion: Story 1 happy: Given an issue body that describes the same problem in neutral prose with no directive shape, when the adapter polls it, then `Envelope.text` is the body unchanged apart from the armor lines and the neutralization list is empty.
Task ids: 2
Done when checks: `sanitize-inbound.test.ts` proves an agent-directive line, a `SYSTEM:` role tag, and a `<system>` element are each replaced in place by their category marker and the neutralization list carries the matching category and count. | `sanitize-inbound.test.ts` proves a neutral body and a body containing only a suspicious word produce an unchanged body and an empty neutralization list. | The fixture corpus under `src/conductor/test/fixtures/intake-inbound/` has at least eight input/expected pairs and every pair passes.
Missing assertion: The checks do not require the polling adapter to place a neutral issue body into Envelope.text unchanged apart from armor lines.

Criterion: Story 1 negative: Given an issue whose entire body is a single directive line, when the adapter polls it, then `Envelope.text` still passes `parseEnvelope` as non-empty because the marker and title remain, and the issue is captured rather than skipped.
Task ids: 5
Done when checks: `github-issues.test.ts` proves poll, re-route, and re-eligibility all emit `text` with armor lines and markers and set `inbound` on the envelope. | `github-issues.test.ts` proves an empty title+body issue produces no envelope and logs the skip with its `sourceRef`, and a single-directive-line body is captured with non-empty `text`. | `buildText()` in `src/conductor/src/engine/engineer/intake/github-issues.ts` is the only production caller of `sanitizeInboundText` and passes the adapter's parsed `WorkRef`.
Missing assertion: The checks do not require that the single-directive-line envelope text successfully passes `parseEnvelope`, specifically because its marker and title remain.

Criterion: Story 1 negative: Given an issue whose title and body are both empty or whitespace, when the adapter polls it, then no envelope is produced and the skip is logged with the `sourceRef`, because the emptiness check runs before the seam and armor lines never make an empty issue look non-empty.
Task ids: 5
Done when checks: `github-issues.test.ts` proves poll, re-route, and re-eligibility all emit `text` with armor lines and markers and set `inbound` on the envelope. | `github-issues.test.ts` proves an empty title+body issue produces no envelope and logs the skip with its `sourceRef`, and a single-directive-line body is captured with non-empty `text`. | `buildText()` in `src/conductor/src/engine/engineer/intake/github-issues.ts` is the only production caller of `sanitizeInboundText` and passes the adapter's parsed `WorkRef`.
Missing assertion: The Done when checks do not require that the emptiness check runs before the seam or that armor lines cannot make an empty issue appear non-empty.

Criterion: Story 2 happy: Given an issue body with a fenced code block containing `ignore all previous instructions`, when the adapter polls it, then the fenced block is byte-identical in `Envelope.text` and no neutralization is recorded for it.
Task ids: 1
Done when checks: `sanitize-inbound.test.ts` proves fenced, indented, and quoted regions are classified `code` and every other line `prose`, for both ``` and ~~~ fences. | `sanitize-inbound.test.ts` proves an unclosed fence classifies every following line as `code`. | `InboundCategory` is a string-literal union of exactly five members and `InboundSanitizeResult` is exported from `src/conductor/src/engine/engineer/intake/sanitize-inbound.ts`.
Missing assertion: The checks do not require polling an issue, preserving a fenced block byte-identically in Envelope.text, or recording no neutralization for it.

Criterion: Story 2 happy: Given an issue body with a four-space-indented block and a `>`-quoted log line each containing a directive shape, when the adapter polls it, then both are byte-identical in `Envelope.text`.
Task ids: 1
Done when checks: `sanitize-inbound.test.ts` proves fenced, indented, and quoted regions are classified `code` and every other line `prose`, for both ``` and ~~~ fences. | `sanitize-inbound.test.ts` proves an unclosed fence classifies every following line as `code`. | `InboundCategory` is a string-literal union of exactly five members and `InboundSanitizeResult` is exported from `src/conductor/src/engine/engineer/intake/sanitize-inbound.ts`.
Missing assertion: The checks do not require polling an issue body or preserving four-space-indented and quoted directive-shaped lines byte-identically in Envelope.text.

Criterion: Story 2 happy: Given an issue body with `## Observed`, `## Desired outcome` with three `- ` bullets, and `## Hypotheses`, when the adapter polls it, then every heading and bullet marker is preserved and `extractDesiredOutcomeSection` returns the same three bullets it returns for the raw body, apart from any in-bullet marker substitution.
Task ids: 3
Done when checks: `sanitize-inbound.test.ts` proves a directive line placed immediately after a closing fence is neutralized and the fenced content before it is byte-identical. | `sanitize-inbound.test.ts` proves a directive `## Desired outcome` bullet keeps its `- ` marker with only the bullet text replaced. | A round-trip test proves `stageIntakeOutcomes` extracts the identical bullet count from raw and sanitized copies of the same issue body.
Missing assertion: The checks do not require preservation of every heading or require raw and sanitized extraction to return the same three bullet values; they require only marker preservation for a directive bullet and identical bullet count.

Criterion: Story 2 negative: Given a fenced block that is never closed, when the adapter polls it, then everything after the opening fence is treated as code and left byte-identical rather than being neutralized.
Task ids: 1
Done when checks: `sanitize-inbound.test.ts` proves fenced, indented, and quoted regions are classified `code` and every other line `prose`, for both ``` and ~~~ fences. | `sanitize-inbound.test.ts` proves an unclosed fence classifies every following line as `code`. | `InboundCategory` is a string-literal union of exactly five members and `InboundSanitizeResult` is exported from `src/conductor/src/engine/engineer/intake/sanitize-inbound.ts`.
Missing assertion: The checks require classifying every line after an unclosed fence as code, but do not explicitly require that those bytes remain byte-identical or are not neutralized.

Criterion: Story 5 negative: Given two worktrees created for two different ideas, when both emit, then each record lands only in its own `<worktree>/.pipeline/events.jsonl` and neither touches the engineer directory nor any sidecar ledger.
Task ids: 9
Done when checks: The worktree CLI test proves `<worktree>/.pipeline/events.jsonl` holds one `intake_inbound_sanitized` record with `sourceRef`, `neutralizations`, `digest`, and `ts` when the claim record carries `inbound`, including when the neutralization list is empty. | The worktree case emits `intake_inbound_sanitized` through a `ConductorEventEmitter` with `EventPersister` attached, and no `<worktree>/.pipeline/intake-events.jsonl` is created. | The worktree CLI test proves no `intake_inbound_sanitized` record is written for an idea without `sourceRef`, and the emit site catches persistence failures so an unwritable `.pipeline/` directory still yields a successful worktree result with the failure on stderr. | The worktree CLI test proves each worktree's record lands only in its own `.pipeline/events.jsonl` and no sidecar ledger is created.
Missing assertion: The checks do not explicitly require that neither worktree touches the engineer directory.
````
