**Status:** Accepted

# Stories: daemon log indentation encodes nesting depth by one rule

Track: technical (no PRD). Tier: S.
Source: jstoup111/ai-conductor#2367. This is the spacing part of split (a), the log-line contract, in the #2867 respec guidance. Line wording, severity, next-action suffixes, verbosity levels, and multi-line summarization belong to the other #2867 splits and are not changed here.

Terms used below. The **prefix** is `[daemon]` or `[daemon][<slug>]`, plus the persisted log's leading timestamp. The **line body** is everything after the prefix and its single separating space. The **depth marker** for depth 0 is empty, for depth 1 it is `· ` (dot, one space), and for depth 2 it is `·   ` (dot, three spaces). A **continuation line** is the second or a later physical line of one logged message.

## Story 1: Every rendered event type logs at its one declared depth

**Requirement:** #2367 desired outcomes 1 and 3

As an operator reading `.daemon/daemon.log` by eye, I want each event's indentation to show its nesting depth and nothing else, so that indentation orients me instead of misleading me.

### Acceptance Criteria

#### Happy Path
- Given any event type in the daemon's rendered event set, when an event of that type is logged, then every line body it produces begins with the depth marker declared for that type, followed by a character that is neither whitespace nor `·`.
- Given the same event logged twice, once through each of two separately created daemon loggers, when both lines are persisted, then the two line bodies are byte-identical.

#### Negative Paths
- Given two `provider_attempt` events for the same step, one whose lifecycle phase is `exhausted` and one whose phase is `preparing`, when both render, then both line bodies begin with the same depth marker.
- Given a `build_review_outer_verdict` event that carries a suppressed finding and an advisory finding, when it renders, then the suppressed-finding line, the advisory-finding line, and the verdict line all begin with the same depth marker.
- Given a depth table that omits one event type the sink registry marks as rendered, when the sources are type-checked, then the type check rejects that table.

### Done When
- [ ] One table declares exactly one depth (0, 1, or 2) for every event type the sink registry marks as rendered, and `npm run typecheck` fails if a rendered type has no entry.
- [ ] Renderer arms no longer write their own `·` marker or leading spaces; the daemon renderer composes the marker from the table.
- [ ] The line-shape test renders a real fixture of every rendered event type through the production renderer and loggers, and asserts the depth rule for every line it produces.

## Story 2: Forwarded subprocess output is marked as continuation and cannot shift indentation

**Requirement:** #2367 desired outcome 2

As an operator, I want git and provider output that arrives inside a daemon message to be visibly distinct from daemon-authored lines, so that its own column padding never looks like daemon nesting.

### Acceptance Criteria

#### Happy Path
- Given a `halt_record_push_failed` event whose reason holds git push output over three lines, when it is logged by a feature logger, then the first line body is the event's normal line at its declared depth, and each later line is its own `[daemon][<slug>]` line whose body is the same depth marker, then `│ `, then that output line's original text.
- Given a repository-wide daemon message over two lines, when it is logged, then both physical lines carry the `[daemon]` prefix, the persisted timestamp, and the depth 0 marker, and the second line body begins with `│ `.

#### Negative Paths
- Given forwarded output whose line is ` ! [rejected]        HEAD -> feat/x (non-fast-forward)`, when it is logged as the second line of a repository-wide daemon message, then that line's body is `│ ` followed by the forwarded line exactly as given, including its leading space and inner column padding.
- Given a multi-line message with a blank middle line and a trailing newline, when it is logged, then the blank middle line logs as a continuation line whose body after the depth marker is exactly `│`, and the trailing newline adds no line.
- Given engine code writes a two-line `console.warn` while the daemon runs, when the console tee writes it to `.daemon/daemon.log`, then both physical lines carry the timestamp, the `[daemon]` prefix, and the `[warn]` tag, and the text after the second line's `[warn] ` tag begins with `│ `.

### Done When
- [ ] One composer in the daemon log module produces every line body: it applies the depth marker and marks continuation lines with `│ `.
- [ ] The feature logger, the repository-wide logger, and the console tee all write multi-line messages through that composer.
- [ ] The line-shape test covers a multi-line event field, a multi-line raw message, and a blank continuation line; a `runDaemonMode` test covers a multi-line `console.warn` read back from `.daemon/daemon.log`.

## Story 3: A daemon line with no declared depth begins at depth 0

**Requirement:** #2367 desired outcome 1

As an operator, I want daemon-authored lines that are not rendered events to start at the first column, so that stray leading spaces in a message never fake a nesting level.

### Acceptance Criteria

#### Happy Path
- Given a daemon-authored message that is not a rendered event, such as `progress re-kick: feature-a retained — halt disposition needs-human`, when it is logged, then its line body is that message exactly, with no depth marker.

#### Negative Paths
- Given a message that begins with leading spaces, such as `   ! [rejected] x`, when a feature logger logs it, then the line body written to both the live and the persisted sink is `! [rejected] x`.
- Given a feature logger logs `▶ start feature-a` twice in a row, when both reach the daemon logger, then only the first is written, exactly as before this change.

### Done When
- [ ] The composer strips leading whitespace from the first line of a message logged without a declared depth, and the result has no depth marker.
- [ ] The daemon logger's start/resume/done transition suppression still matches lifecycle lines after line composition.
