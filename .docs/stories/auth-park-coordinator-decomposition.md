**Status:** DRAFT

# Technical Story: Decompose the authentication park coordinator

**Origin:** #970 retrospective A-1

As a harness maintainer, I want the Codex-specific recovery policy separated from the common authentication-park orchestration so that timeout, telemetry, and source-specific behavior remain understandable without duplicating terminal semantics.

## Acceptance Criteria

### Happy Paths

- Given cached-login recovery is non-ready, when the coordinator runs, then the extracted policy preserves immediate recheck, capped 1/2/4/8/16/30-second backoff, deadline clamping, and rate-limited sanitized progress.
- Given serial, grouped, judgment, or auxiliary dispatch reaches authentication recovery, when the selected source becomes ready, then the existing caller resumes only its eligible failed work.

### Negative Paths

- Given timeout or an API-key restart-required source, when recovery terminates, then the existing selected provider/source disposition and zero retry/escalation/model/provider/source-fallback budgets are preserved.
- Given a new recovery policy branch is added, when it cannot produce a closed typed readiness/progress result, then TypeScript exhaustiveness or a focused test fails rather than silently widening the common coordinator.

## Done When

- [ ] The common coordinator is below the repository's 25-line guideline or delegates each source-specific policy to named helpers with one responsibility.
- [ ] Existing real caller-seam timeout tests remain green for serial, grouped, judgment, and auxiliary paths.
- [ ] No raw provider diagnostic or credential data crosses the extracted policy boundary.
