**Status:** Accepted

# Stories: Daemon log lines are readable to operators (#2867, covers #2367)

Technical track (no PRD). Tier: M. Source: jstoup111/ai-conductor#2867. This spec also delivers every
Desired outcome of jstoup111/ai-conductor#2367 ("Daemon log lines have inconsistent leading spacing"),
in Story 8, by operator decision to ship both issues as one spec.

**Terms used below.**

- *Default log* — `.daemon/daemon.log` and the daemon's live console when the project config leaves
  `daemon_verbose` unset or `false`.
- *Verbose log* — the same outputs when the project config sets `daemon_verbose: true`.
- *Line body* — the text after the `[daemon][<tag>] ` or `[daemon] ` prefix (and after the leading
  timestamp in the file). The prefix and tag themselves are out of scope (#2368).
- *Dispatch* — one run of one feature by the daemon, from its start/resume line to its done line.
- *UUID-shaped token* — a run of hex digits in the 8-4-4-4-12 form, e.g.
  `be29ebf5-65fd-4367-98b0-1f20fcdbc3ef`.
- *Next-action suffix* — a line ending in either ` — next: <operator action>` or
  ` — no action needed: <reason>`.

The event ledger `.pipeline/events.jsonl` keeps every event's full payload; these stories change only
what the daemon log shows.

## Story 1: A build_review FAIL that adjudication can overturn reads as provisional, then one final verdict

**Requirement:** TI-1 (technical intent: #2867 outcome "a gate verdict that adjudication can still overturn is labelled provisional … and a single final-verdict line follows adjudication")

As an operator tailing the daemon log, I want a build_review FAIL that is still subject to
adjudication to say so, and one line that states the verdict adjudication settled on, so that I never
read a passed build as a failed one.

### Acceptance Criteria

#### Happy Path
- Given a daemon build_review lap whose effective verdict is FAIL and which the conductor will adjudicate, when the step failure is logged, then its line contains `provisional FAIL`, says adjudication is pending, and ends with a no-action-needed suffix.
- Given that lap's adjudication rejects every unresolved finding and routes the lap to pass, when adjudication finishes, then exactly one final-verdict line for that lap is logged that states `PASS`, says the provisional FAIL was overturned, and names each rejected finding by its title.
- Given that lap's adjudication routes it back to BUILD, stops for a decision, or halts, when adjudication finishes, then exactly one final-verdict line for that lap is logged that states that route and ends with a next-action suffix.

#### Negative Paths
- Given a build_review FAIL that the conductor will not adjudicate (adjudication disabled, or the verdict is not a parseable aggregate), when the step failure is logged, then the line is the ordinary `failed` line, does not contain the word `provisional`, and no final-verdict line follows for that lap.
- Given an adjudicated lap, when the default log is read, then it contains no line beginning with `route:` and no line beginning with a case identifier followed by a `[<disposition>/<resolution>]` pair.
- Given an adjudication that settles over more than one round within one lap, when it finishes, then exactly one final-verdict line is logged for that lap, not one per round.

### Done When
- [ ] A renderer test shows the provisional line for a `step_failed` marked pending-adjudication and the ordinary failed line for an unmarked one.
- [ ] A conductor-level test drives an adjudicated pass lap and a repair lap and observes exactly one final-verdict event and line per lap, with titles.
- [ ] The default log of an adjudicated lap contains no raw adjudication trace line.

## Story 2: Findings are named by title, not by hash

**Requirement:** TI-2 (technical intent: #2867 outcome "findings are shown by human-readable title, not only sha256 id")

As an operator, I want a build_review failure line to say what the findings are, so that I can judge
the failure without opening the aggregate artifact.

### Acceptance Criteria

#### Happy Path
- Given an effective build_review FAIL with one unresolved finding whose aggregate summary is `Missing negative-path test for park`, when the failure is logged, then the line contains `Missing negative-path test for park` and that finding's rubric, and does not contain the finding's `sha256:` id.
- Given an effective FAIL with several unresolved findings, when the failure is logged, then every finding appears by its own title on that one line, in the same order on every render of the same aggregate.
- Given a build_review lap that suppresses a below-floor finding whose aggregate summary is `Prefer a named constant`, when the lap's outer verdict renders, then the suppressed-finding line names `Prefer a named constant` with its rubric, confidence and floor, and does not contain the finding's `sha256:` id.

#### Negative Paths
- Given an unresolved finding id that has no summary in the aggregate, when the failure is logged, then that finding appears by its id instead of being omitted, and every other finding still appears by title.
- Given a finding summary that contains a line break, when the failure is logged, then the title appears on the same physical line with its whitespace collapsed to single spaces.
- Given a persisted outer-verdict event whose suppressed-finding entry carries no summary (recorded before this change), when it renders, then that finding is named by its rubric and id and the line still renders.

### Done When
- [ ] The effective-FAIL completion reason and the suppressed-finding line name findings by summary and rubric, with an id fallback.
- [ ] Tests cover single, multiple, suppressed, missing-summary and multi-line-summary findings.

## Story 3: The default log carries no UUIDs

**Requirement:** TI-3 (technical intent: #2867 outcome "no bare UUIDs appear in the default operator log view")

As an operator, I want identifiers I cannot act on kept out of the default log, so that lines are
short and readable, while I can still correlate a line with the event ledger when I need to.

### Acceptance Criteria

#### Happy Path
- Given every event type the daemon renders, each carrying a UUID-shaped value in every identifier field it has (provider attempt, adjudication case, dispatch, event, session), when each renders to the default log, then no rendered line contains a UUID-shaped token.
- Given the verbose log, when a provider lifecycle event, a managed-session occurrence, and an adjudicated lap's per-case detail render, then their identifiers appear on their lines.

#### Negative Paths
- Given a provider attempt that exhausts its recovery and halts, when it renders to the default log, then the line names the step, the halted phase, the recovery count and the reason, and contains no UUID-shaped token.
- Given a managed-session command refusal or a GitHub bypass occurrence, when it renders to the default log, then the line names the feature, the provider and the refused command or operation, and contains no UUID-shaped token.

### Done When
- [ ] A test renders a fixture for every rendered event type with UUID-shaped identifiers and asserts no default line matches the UUID shape.
- [ ] Verbose-mode tests show identifiers retained for lifecycle, session-occurrence and adjudication-detail lines.

## Story 4: A halted feature's retention is logged once per state change

**Requirement:** TI-4 (technical intent: #2867 outcome "a halted feature's retention is logged once per state change, not every tick")

As an operator, I want one line when the daemon decides to leave a halted feature alone, and another
only when that decision changes, so that the retention lines stop burying everything else.

### Acceptance Criteria

#### Happy Path
- Given a halted feature retained with disposition `needs-human`, when ten consecutive daemon ticks evaluate it, then exactly one retention line for it is logged, naming the slug, `needs-human`, and a next-action suffix.
- Given that retained feature's disposition changes from `needs-human` to `kickback-cap`, when the next tick evaluates it, then one new retention line naming `kickback-cap` is logged.

#### Negative Paths
- Given a retained feature whose halt is cleared and which later halts again with the same disposition, when a tick evaluates the new halt, then a new retention line is logged for it.
- Given two halted features retained with the same disposition, when ticks evaluate both, then each feature has exactly one retention line, each naming its own slug.
- Given a daemon restart while a feature remains retained, when the new daemon process first evaluates it, then exactly one retention line for it is logged.
- Given the progress re-kick check, the episode-end sweep and the base-advance re-kick sweep each evaluate the same retained feature with an unchanged disposition, when all three run, then that feature has one retention line in total, not one per check.

### Done When
- [ ] One daemon-scoped retention record is consulted by all three retention checks.
- [ ] Tests cover repeat ticks, a disposition change, clear-and-rehalt, two features, a fresh daemon, and the three checks together.

## Story 5: Per-step boilerplate appears once per dispatch or only in the verbose log

**Requirement:** TI-5 (technical intent: #2867 outcome "per-step boilerplate … appears at most once per run or only at a verbose level")

As an operator, I want lines that repeat for every step with the same content to appear once, and
routine lifecycle chatter to appear only when I ask for it, so that each step contributes only what
changed.

### Acceptance Criteria

#### Happy Path
- Given a self-host dispatch whose steps each report the same containment verdict and reason, when the default log is read, then that containment line appears once for the dispatch.
- Given a self-host dispatch whose steps each produce a boundary fingerprint, when the default log is read, then only the dispatch's first fingerprint line appears; when the verbose log is read, then every fingerprint line appears.
- Given a dispatch whose steps each report the same session policy notice for the same provider and reason, when the default log is read, then that notice appears once for the dispatch.
- Given a provider attempt that moves through preparing, running and settled, when the default log is read, then none of those three lifecycle lines appears; when the verbose log is read, then each appears with its attempt identity.

#### Negative Paths
- Given a dispatch whose containment verdict changes between steps (from contained to unavailable, or to a different reason), when the default log is read, then a containment line appears for each change.
- Given a provider attempt that enters recovery or exhausts its recovery, when the default log is read, then a recovering line naming the step, recovery count and timeout reason, or a halt line, appears.
- Given a provider invocation that replaces a caller-supplied session id without a resume request, when the provider runs, then no session-replacement line is written to the daemon log at either verbosity; given one that suppresses a requested resume, then exactly one line says resume was suppressed and ends with a no-action-needed suffix.
- Given a second dispatch of the same feature, when its first containment verdict, fingerprint and session policy notice occur, then each appears again in the default log.

### Done When
- [ ] Containment, fingerprint and session-policy lines are suppressed after their first default render within one dispatch, and re-render on a changed verdict.
- [ ] Routine provider lifecycle phases render only under `daemon_verbose: true`; recovering and halted phases render at default.
- [ ] The routine fresh-session replacement writes nothing to the daemon log.

## Story 6: Raw, multi-line and JSON output is summarized to one line

**Requirement:** TI-6 (technical intent: #2867 outcome "raw JSON, raw git stderr and multi-line prompt/agent text do not appear inline in the default log; where retained, they are summarized to one line")

As an operator, I want a step failure whose message carries a test run, git output or prompt text to
occupy one line, so that the log stays scannable, and I want that line to tell me where the rest is.
*Forwarded output* here means text the daemon passes through from elsewhere: event payload text (a
step error, a halt reason) and provider diagnostic output. Multi-line text the daemon composes itself
stays whole.

### Acceptance Criteria

#### Happy Path
- Given a step failure whose error text has 40 lines including git push output and test-runner output, when it is logged to the default log, then exactly one line is written for it, containing the error's first line, the count of omitted lines, and a pointer to the feature's `.pipeline/events.jsonl` and to `daemon_verbose: true`.
- Given a loop halt whose reason has several lines, when it is logged to the default log, then exactly one line is written, containing the reason's first line and a pointer to the feature's `.pipeline/HALT`.
- Given the verbose log, when the same 40-line step failure is logged, then its first line is followed by each non-blank continuation line, each beginning with the forwarded-output marker `│ `.

#### Negative Paths
- Given forwarded provider diagnostic output whose entire content is a single-line JSON object or array, when it is logged to the default log, then the line is replaced by a one-line summary naming it a JSON payload and its size in bytes.
- Given single-line forwarded output that begins with `{` but is not valid JSON, when it is logged, then it is written unchanged.
- Given a multi-line message containing blank or whitespace-only lines, when it is logged at either verbosity, then no blank or whitespace-only line is written.
- Given a multi-line event payload rendered by the daemon-wide subscriber, which has no feature tag, when it is logged to the default log, then it is collapsed to one line in the same way as a feature-owned payload.
- Given a multi-line message the daemon composes itself (such as a per-file table or a setup output tail that an existing decision requires in the log), when it is logged at either verbosity, then every non-blank line is written and each continuation line body begins with `│ `.

### Done When
- [ ] The daemon logger collapses forwarded multi-line and whole-JSON output at default, marks continuation lines when verbose, and keeps daemon-composed multi-line messages whole with marked continuations.
- [ ] The step-failure and halt renderers name where the full text is kept.
- [ ] Tests cover feature-owned and daemon-wide messages, blank lines, JSON and invalid JSON.

## Story 7: Every warning and halt line says what to do next

**Requirement:** TI-7 (technical intent: #2867 outcome "every warning/halt line in the log states the next operator action, or says none is needed")

As an operator, I want each warning or halt line to tell me whether I need to act and how, so that I
can triage from the log alone.

### Acceptance Criteria

#### Happy Path
- Given each event type the daemon renders with warning or halt severity, when it renders, then its line ends with a next-action suffix.
- Given a feature halt line (a loop halt or the dispatch's halted line), when it renders, then its suffix names `ai-conductor monitor`; given a retention line for a feature with a recognized halt disposition, when it renders, then its suffix names `ai-conductor monitor` and that disposition's recovery procedure.

#### Negative Paths
- Given a warning the daemon recovers from on its own (a rate-limit wait, a provider fallback, a step retry), when it renders, then its suffix is `no action needed:` with the reason, not an operator action.
- Given a retention line whose disposition is unclassified or unrecognized, when it renders, then its suffix gives the undetermined-classification procedure rather than a disposition-specific runbook.
- Given a raw daemon line outside the event renderer that is marked as a warning or halt (`WARNING:`, `⚠`, `✋`, or a feature halt), when it is logged, then it also ends with a next-action suffix.
- Given an informational line (a step start or completion, a progress heartbeat, a cache hit), when it renders, then no next-action suffix is appended.

### Done When
- [ ] Warning and halt lines cannot be constructed without a next action.
- [ ] A test renders every warning/halt event type and asserts the suffix; a source audit rejects unrouted raw warning markers.

## Story 8: Indentation after the prefix encodes nesting depth by one rule (#2367)

**Requirement:** TI-8 (technical intent: #2367 outcomes — whitespace after the prefix means one thing; forwarded subprocess output is distinguishable and cannot shift the daemon's indentation; the same event type logs at the same indentation on every dispatch)

As an operator reading the log by eye, I want indentation to show nesting and nothing else, so that it
orients me instead of misleading me.

### Acceptance Criteria

#### Happy Path
- Given any event the daemon renders, when it is logged, then its line body begins at the column for its declared depth — depth 0 at column 0, depth 1 after `· `, depth 2 after `·   ` — and that event type uses the same depth on every dispatch and at both verbosities.
- Given forwarded subprocess output shown in the verbose log, when it is logged, then its first line joins the daemon line it belongs to at that line's depth, and each following forwarded line body begins with `│ ` with the output's own leading whitespace after that marker.

#### Negative Paths
- Given forwarded output whose first line begins with whitespace, such as ` ! [rejected]  HEAD -> feat/x`, when it is logged to the default log, then no line body begins with that whitespace.
- Given two events of the same type whose payloads differ in outcome (a provider attempt that succeeds and one that fails), when both render, then both line bodies begin at the same depth column.
- Given a daemon line whose message an emitter composed with its own leading spaces, when it is logged, then the line body begins at the column of the depth the emitter declared, with the extra leading spaces removed.

### Done When
- [ ] One presentation table declares a single depth for every rendered event type, checked exhaustively.
- [ ] The daemon logger alone composes the depth prefix and the forwarded-output marker.
- [ ] Tests assert the column rule for every rendered event type fixture and for raw messages with leading whitespace.
