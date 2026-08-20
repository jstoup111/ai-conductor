# Coherence: feature-specific pattern reuse and lowest-sufficient testing

**Date:** 2026-08-13  
**Tier:** M  
**Track:** Technical

The outcome row class is omitted because this chat-origin specification has no staged outcomes file
or plan-stem intake marker. The FR row class is omitted for the technical track. The ADR row class
is omitted because the current specification change set adds, modifies, or deletes no
`.docs/decisions/adr-*` file.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-3, task-4 | covered | The tasks establish architecture precedence, record the feature-bounded semantic basis, and carry it into affected plan tasks. |
| story | story-2 | task-4, task-5, task-6, task-7, task-9, task-10 | covered | The tasks relay focused context, rediscover the current equivalent, require a behavior-complete conforming GREEN, and reject material drift. |
| story | story-3 | task-3, task-5, task-9, task-10, task-11 | covered | Architecture, dispatch, code review, evaluator, and simplification guidance share the same material-trait basis while allowing immaterial variation. |
| story | story-4 | task-1, task-2, task-4, task-5, task-7, task-8, task-9, task-11 | covered | The tasks assign lowest-sufficient coverage, reject redundant test derivation, and preserve the declared exact-replication exception. |
| task | task-1 | story-1, story-4 | covered | The shared authority rule serves Story 1 and keeps Story 4's exact-replication amendment distinct. |
| task | task-2 | story-4 | covered | The shared coverage rule implements Story 4's disposition and lowest-sufficient-layer requirements. |
| task | task-3 | story-1, story-3 | covered | Architecture review records the basis Story 1 requires and supplies the common basis used by Story 3 reviews. |
| task | task-4 | story-1, story-2, story-4 | covered | Plan guidance carries the accepted basis and assigns task-level test dispositions. |
| task | task-5 | story-2, story-3, story-4 | covered | Pipeline guidance relays current-HEAD context to implementers and reviewers while preserving exact replication. |
| task | task-6 | story-2 | covered | Generator guidance implements current-HEAD rediscovery and conditionally conforming GREEN behavior. |
| task | task-7 | story-2, story-4 | covered | TDD guidance aligns conditional conformance with behavior-boundary test scope. |
| task | task-8 | story-4 | covered | Acceptance-spec guidance makes every criterion disposition-driven without weakening genuine RED or exact-copy behavior. |
| task | task-9 | story-2, story-3, story-4 | covered | Code review rejects a smaller material departure and judges both semantic conformance and sufficient coverage. |
| task | task-10 | story-2, story-3 | covered | The fresh evaluator uses the same basis and rejects materially non-conforming passing work. |
| task | task-11 | story-3, story-4 | covered | Simplification preserves the accepted basis and removes tests lacking independent behavioral value. |

## Consistency Result

Every cited counterpart exists in the accepted stories or approved plan. The cross-layer pass found
no static contradiction or oscillation: architecture remains authoritative; local-pattern
conformance is conditional on an applicable basis; verified no-fit and authorized bounded departure
remain valid; and lowest-sufficient test selection does not override the separately declared exact-copy
contract.
