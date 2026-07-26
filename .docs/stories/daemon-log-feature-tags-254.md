**Status:** Accepted

# Daemon log feature tags

## Story 1: Attribute feature-owned daemon lines

As an operator monitoring or reviewing daemon output, I want lines belonging to a feature's execution or lifecycle to identify that feature so that interleaved and historical activity is attributable at a glance.

### Acceptance Criteria

#### Happy Path

- Given a daemon is executing a feature with slug `daemon-logs-tag-current`, when a line is emitted through that feature's lifecycle—including setup output, step events, feature-owned warnings, retries, and subprocess diagnostics—then the live and persisted forms begin with `[daemon][daemon-logs-tag-current]` before the line content.
- Given an active feature slug longer than 24 characters, when its line is rendered, then the feature tag contains a deterministic 24-character display value ending in `…`, while the line content remains intact.
- Given an active feature slug whose display value fits within 24 characters, when its line is rendered, then the tag contains the complete slug without an ellipsis.

#### Negative Paths

- Given the daemon emits repository-global output while no feature owns the line, when the line is rendered, then it retains the existing `[daemon]` prefix and gains no fabricated or stale feature tag.
- Given an unrelated process-wide diagnostic is emitted outside the feature-owned logging boundary while a feature is active, when the line is rendered, then it remains repository-global and is not required to carry that feature's tag.
- Given feature-owned content already contains text resembling `[daemon]` or a feature tag, when the outer daemon logger renders it, then exactly one daemon prefix and exactly one active-feature tag are added; content is not parsed into a second contextual prefix.
- Given two feature loggers emit lines during overlapping execution, when their output is persisted, then each line carries its own logger's feature tag and never the other feature's tag.

### Done When

- [ ] A focused test exercises representative setup, structured-event, feature-owned warning, retry, and subprocess-diagnostic lines through the feature-owned logging boundary and observes `[daemon][<feature>]` in both live and persisted output.
- [ ] Boundary tests verify short slugs, deterministic 24-character truncation with `…`, and absence of feature tags on repository-global lines.
- [ ] A two-feature test proves attribution is logger-local and does not leak across interleaved lines.
- [ ] Existing daemon log timestamps, ANSI stripping, rotation, transition suppression, and greppable message content remain unchanged after the new contextual prefix.
