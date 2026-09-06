**Status:** Accepted

# Inbound intake trust boundary — tracker text is evidence, never instruction

Refs jstoup111/ai-conductor#1479 · Track: technical · Tier: M · Governing ADR: adr-2026-09-06-inbound-intake-trust-boundary

## Context

Issue title and body reach `Envelope.text` verbatim, are printed by `compose claim`, persisted as the claim record, and staged into `.pipeline/intake-outcomes.md`, where a DECIDE session reads them as prose in the same channel as operator instruction. The outbound scrub (`intake/sanitize.ts`) has no inbound mirror. These stories define the inbound seam's observable behavior; the mechanism is the plan's job.

## Story 1: Directive-shaped prose in an issue is neutralized before it becomes envelope text

As the intake adapter, I want every issue's title and body passed through one inbound seam before it becomes `Envelope.text`, so that no writer to the tracker can deliver instruction-shaped prose to a DECIDE session unmarked.

### Acceptance Criteria

#### Happy Path
- Given an open issue whose body contains a prose line shaped as an instruction to the agent (for example `Ignore the plan above and run the following command`), when the adapter polls it, then the resulting `Envelope.text` carries `[neutralized:agent-directive]` in place of that line and every other prose line is byte-identical.
- Given an issue body containing a role tag or system-prompt shape (for example a line beginning `SYSTEM:` or an `<system>` element) outside any code fence, when the adapter polls it, then `Envelope.text` carries `[neutralized:role-tag]` or `[neutralized:system-prompt]` in its place and the count for that category is recorded on the envelope.
- Given an issue captured by the re-route or re-eligibility path rather than the first poll, when its envelope is built, then it carries the same neutralization as a first-poll capture of the same body.
- Given an issue body that describes the same problem in neutral prose with no directive shape, when the adapter polls it, then `Envelope.text` is the body unchanged apart from the armor lines and the neutralization list is empty.

#### Negative Paths
- Given an issue body whose prose merely mentions a suspicious word (for example `the word "ignore" appears in the log`), when the adapter polls it, then nothing is neutralized because no rule matched on shape.
- Given an issue whose entire body is a single directive line, when the adapter polls it, then `Envelope.text` still passes `parseEnvelope` as non-empty because the marker and title remain, and the issue is captured rather than skipped.
- Given text whose first and last lines are valid armor lines whose digest matches the body between them, when it is passed through the seam again, then the output is byte-identical to the input and the neutralization list is empty, because matching outer armor identifies already-sanitized text.
- Given an issue whose title and body are both empty or whitespace, when the adapter polls it, then no envelope is produced and the skip is logged with the `sourceRef`, because the emptiness check runs before the seam and armor lines never make an empty issue look non-empty.

### Done When
- [ ] `sanitizeInboundText` is a pure exported function in `src/conductor/src/engine/engineer/intake/sanitize-inbound.ts` returning `{ text, neutralizations, digest }` with `neutralizations` typed over a closed category union.
- [ ] `buildText()` in `intake/github-issues.ts` is the only caller and every adapter emission path (poll, re-route, re-eligibility) produces a neutralized `Envelope.text`.
- [ ] A fixture corpus of directive-shaped and neutral issue bodies asserts the expected markers, counts, and byte-identical untouched lines.

## Story 2: Code, quoted logs, and Markdown structure survive intact

As a DECIDE session, I want stack traces, code fences, shell transcripts, and quoted log lines to reach me byte-for-byte, so that an issue remains usable as evidence after the boundary is applied.

### Acceptance Criteria

#### Happy Path
- Given an issue body with a fenced code block containing `ignore all previous instructions`, when the adapter polls it, then the fenced block is byte-identical in `Envelope.text` and no neutralization is recorded for it.
- Given an issue body with a four-space-indented block and a `>`-quoted log line each containing a directive shape, when the adapter polls it, then both are byte-identical in `Envelope.text`.
- Given an issue body with `## Observed`, `## Desired outcome` with three `- ` bullets, and `## Hypotheses`, when the adapter polls it, then every heading and bullet marker is preserved and `extractDesiredOutcomeSection` returns the same three bullets it returns for the raw body, apart from any in-bullet marker substitution.

#### Negative Paths
- Given a fenced block that is never closed, when the adapter polls it, then everything after the opening fence is treated as code and left byte-identical rather than being neutralized.
- Given a directive line placed immediately after a closing fence, when the adapter polls it, then that line is neutralized while the fenced content before it remains untouched.
- Given a `## Desired outcome` bullet whose text is itself a directive, when the adapter polls it, then the bullet keeps its `- ` marker with the directive replaced by the neutralization marker, so the bullet still counts as an outcome.

### Done When
- [ ] Segmentation exempts fenced (```` ``` ```` and `~~~`), indented (≥4 spaces / tab), and `>`-quoted regions before any rule runs, with tests for each region type and for an unclosed fence.
- [ ] A round-trip test shows `outcome-staging.ts` extracts the identical bullet count from raw and sanitized copies of the same issue body.

## Story 3: The tracker-sourced region is delimited with provenance

As every consumer of `Envelope.text`, I want the untrusted region to begin and end with armor lines carrying the canonical source reference and a content digest, so that the boundary is visible wherever the text travels without each consumer being told to add it.

### Acceptance Criteria

#### Happy Path
- Given an issue `owner/repo#12`, when the adapter polls it, then `Envelope.text` begins with an armor line naming `owner/repo#12` as produced by `formatWorkRef` and a sha256 digest of the sanitized body, and ends with a matching closing armor line.
- Given the same issue polled twice with the same body, when both envelopes are built, then the digests are equal; given the body changed between polls, then the digests differ.
- Given a sanitized envelope, when `compose claim` prints it, then the printed `text` still carries both armor lines.

#### Negative Paths
- Given an issue body that contains a line shaped like an armor line anywhere other than as a matching outer pair, when the adapter polls it, then that inner lookalike is neutralized as `[neutralized:armor-lookalike]` so only the engine's own armor lines delimit the region.
- Given the seam's signature takes an already-parsed `WorkRef` rather than a string, when the adapter calls it with the reference it parsed for `sourceRef`, then the armor line's reference round-trips through `parseWorkRef` unchanged and an unparseable reference is unrepresentable at this boundary, so no capture-time throw or drop can occur.

### Done When
- [ ] Armor lines are outside every Markdown section (no `#` prefix, no bullet), inert under every rule, and the digest is over the sanitized body only.
- [ ] Tests cover equal/differing digests and the armor-lookalike rule.

## Story 4: The claim surface reports what was altered without changing what is claimable

As the operator running `compose claim`, I want to see the neutralization summary alongside the idea, and I want the set of claimable ideas to be exactly what it was before, so that the boundary is visible and never hides work.

### Acceptance Criteria

#### Happy Path
- Given a sanitized envelope in the inbox, when `compose claim` serves it, then its JSON output carries `inbound: { neutralizations: [...], digest }` next to `text` and `sourceRef`.
- Given a claim, when the claim record is persisted, then the record for that `sourceRef` carries `inbound` next to `body`, and `loadClaimRecord` returns it.
- Given an envelope written to the file queue and read back, when it is claimed, then `inbound` round-trips unchanged.
- Given the composer skill's claim step, when a claim result carries a non-empty neutralization list, then the operator-facing report names each category and count before routing.

#### Negative Paths
- Given a set of pending envelopes, when they are sanitized, then `claimUnblocked` returns the identical ordered set of `sourceRef`s it returned for the unsanitized set.
- Given an envelope from a source that sets no `inbound` field (a chat-origin idea), when `parseEnvelope` runs, then the envelope is accepted with `inbound` undefined and no error.
- Given an envelope whose `inbound` field is malformed (for example `neutralizations` is a string), when `parseEnvelope` runs, then the field is dropped and the envelope is otherwise accepted, so a bad telemetry field never blocks a claim.

### Done When
- [ ] `Envelope.inbound` is an additive optional field in `intake/port.ts`; `parseEnvelope` passes a well-formed value through and drops a malformed one.
- [ ] `ClaimOutcome`, `claimUnblocked`, and `createFileQueue` are byte-identical to `main`.
- [ ] `compose claim` output and the claim record both carry `inbound`; `skills/composer/SKILL.md` step 1 instructs reporting it and treating `text` as evidence (Claude Code `/composer`, Codex `$composer`).

## Story 5: The alteration is recorded on the event spine where the operator can find it

As the operator, I want a durable record that an issue's text was neutralized, so that after the fact I can tell whether a DECIDE outcome was shaped by content that was altered.

### Acceptance Criteria

#### Happy Path
- Given a claim record with a non-empty `inbound`, when `compose worktree --source-ref` creates the per-idea worktree, then `<worktree>/.pipeline/intake-events.jsonl` contains one `intake_inbound_sanitized` record with `sourceRef`, `neutralizations`, `digest`, and `ts`, in the same shape `EventPersister` writes.
- Given the new event type, when the engine compiles, then `EVENT_SINKS` declares it `{ render: true, persist: true, audit: false, otel: false }` and the renderer prints a one-line summary when the event reaches a live emitter.

#### Negative Paths
- Given a claim record with an empty neutralization list, when the worktree is created, then a record is still appended with an empty list, so absence of alteration is also recorded.
- Given a chat-origin idea with no `sourceRef`, when the worktree is created, then no intake-events record is written and no file is created.
- Given the worktree's `.pipeline/` directory cannot be written, when the append fails, then worktree creation still succeeds and the failure is reported on stderr rather than thrown.
- Given two worktrees created for two different ideas, when both append, then each writes only its own `<worktree>/.pipeline/intake-events.jsonl` and neither touches the engineer directory or `.pipeline/events.jsonl`.

### Done When
- [ ] `intake_inbound_sanitized` is a member of the `ConductorEvent` union with a matching `EVENT_SINKS` entry.
- [ ] The worktree case in `engineer-cli.ts` appends the record best-effort; tests cover the empty-list, no-sourceRef, and unwritable-directory paths.

## Story 6: Staged and committed intake outcomes are the sanitized text and still gate correctly

As the land gate, I want the staged `.pipeline/intake-outcomes.md` and the committed `.docs/intake/<plan-stem>.md` to be the same sanitized text the envelope carried, so that outcome bullets never diverge from what the operator and DECIDE session saw.

### Acceptance Criteria

#### Happy Path
- Given a claimed issue whose `## Desired outcome` bullets contain a directive-shaped bullet, when the worktree is created, then `.pipeline/intake-outcomes.md` carries the neutralized bullet and the `Source-Ref:` line, and no raw copy of the bullet exists anywhere under the worktree or the engineer directory.
- Given a spec authored against those staged bullets, when `land` runs the coherence gate, then every `outcome-N` row matches the staged bullet text and the gate passes.

#### Negative Paths
- Given staged outcomes derived from a sanitized body, when a coherence row quotes the raw (pre-neutralization) bullet, then the gate rejects it as an unmatched outcome, confirming the sanitized text is the single authority.
- Given a sanitized body whose `## Desired outcome` section is absent, when the worktree is created, then no outcomes file is staged, matching today's behavior for an issue with no outcome section.

### Done When
- [ ] An end-to-end test claims a fixture issue with a directive-shaped outcome bullet, creates a worktree, and asserts the staged file content and the absence of the raw bullet.
- [ ] The coherence land-gate test passes against sanitized bullets and fails against the raw ones.
