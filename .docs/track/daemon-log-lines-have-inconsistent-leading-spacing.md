# Track: Daemon log lines have inconsistent leading spacing

Track: technical

Scope boundary: the whitespace and marker between the `[daemon]`/`[daemon][<slug>]` prefix and the line body only — one declared depth per rendered event type, one composition of that depth, and a distinct marker for continuation (forwarded subprocess) lines. Excluded: line content and wording, severity, next-action suffixes, UUID removal, verbosity levels, multi-line summarization, build_review verdict lines, and halt-retention dedup. Those belong to the other #2867 respec splits. Operator-delegated scope, 2026-10-28: spec #2367 standalone as the spacing part of #2867 respec split (a), and state the rule as one invariant enforced by a single test that renders every event type.

Daemon log presentation is internal operator tooling with no product requirements; acceptance criteria live in stories. Chosen approach: a typed per-event-type depth table plus one line composer in the daemon log module, proven by one test over every type in `renderedEventTypes()`. Rejected: flattening every line to depth 0, which loses the nesting the issue asks a reader to see; and fixing the inconsistent renderer arms one by one, which is the site-list shape that kept #3078 from converging (#3230). Source: jstoup111/ai-conductor#2367.
