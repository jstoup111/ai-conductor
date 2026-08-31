# Track: A coverage claim can name a task whose Done when does not assert the criterion

Track: technical

Scope boundary: Both coverage-claim surfaces at every tier — the coherence artifact's criterion rows (M/L) and the plan's own coverage table (S). Two mechanisms: (1) a mechanical land-time contract that every claim quotes a check from the cited task's `Done when` block, and (2) a fresh-context pre-BUILD binding judge, config-gated and DEFAULT OFF in this spec; a follow-up PR after this spec lands flips the default on. Post-land amendment re-validation (Desired-outcome bullet 5) is covered only as a side effect of the judge running at dispatch, not as a primary target.

Internal harness gate; the staged Desired-outcome bullets already carry the requirements into stories and coherence, so a PRD would duplicate them.
