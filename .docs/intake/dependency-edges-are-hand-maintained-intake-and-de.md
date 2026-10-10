# Intake origin: dependency-edges-are-hand-maintained-intake-and-de

Source-Ref: jstoup111/ai-conductor#536
Owner: jstoup111

## Desired outcome

- Filing an intake that declares dependencies (structured field or the exact prose grammar `issue-dep-migration.ts` already recognizes) produces the native blocked_by links at creation time — verifiable by filing a test issue with "blocked by #N" prose and reading its links.
- The engineer's DECIDE, when landing a spec for issue X, proposes the edges implied by its artifacts (operator confirms; never silently applied).
- A periodic or on-poll sweep flags drift: prose-declared-but-unlinked deps, links to closed issues, and edges contradicting each other — surfaced as a report, not auto-mutated.
- Negative path: ambiguous prose ("related to #N", backward-direction references) creates NO edge — same conservatism `issue-dep-migration.ts` documents ("only the three unambiguous, forward-direction, same-repo" patterns).
