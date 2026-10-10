# Track: Test files outside test/-style paths are silently out of testQuality scope (#2807)

Track: technical

Scope boundary: Balanced — all three desired outcomes of #2807, nothing wider. (1) `build_review`
testQuality scope admits a changed file that carries a well-formed `Covers:` reference (FR, story
criterion, or `task:` id) regardless of its path, and analyzes it exactly as a conventional test
file; the testQuality preflight treats an admitted file that became a counterfactual selector as a
changed test, never as production to revert. (2) An admitted file that still yields no review target
and no concrete candidate is reported as excluded, naming the file and a closed reason, on the
existing `build_review_scope_summary` event. (3) One shared path-convention predicate replaces the
three private/divergent `isTestPath` definitions (gate invalidation, build_review input assembly,
testQuality preflight). Excluded: new path conventions (for example `*_test.go` beside source or
`test_*.sh` anywhere) — those layouts are covered by marker admission instead; content-based
classification in gate invalidation, rebase, or autoresolve (they remain path-only); changes to the
testQuality reviewer projection, rubric prompt, or result schema; any new event variant or render
policy change.

Internal engine change to build_review scope assembly and path classification; no user-facing
product requirements warrant a PRD.

## Approach decision

Approaches weighed (filer hypotheses are candidates, not requirements):

- **A — Content admission plus excluded-file report, one shared path predicate (selected).** A
  `Covers:` marker is the harness's own declaration that a file is coverage evidence, so it is the
  right admission signal for layouts the path conventions do not know. Admitted files flow through
  the unchanged analyzer, so a supported-language test becomes a target and an unsupported-language
  file with an introduced feature-resolvable marker becomes a concrete candidate, exactly as it would
  under `test/`. Anything still unreviewable is reported, closing the silent drop. Est. effort: ~half
  day. Impact: no marker-bearing test is silently skipped in any consumer layout.
- **B — Report-only exclusion notice (filer hypothesis, report half).** Keep path scoping; only emit
  a notice naming dropped marker-bearing files. Rejected: it makes the gap visible but never reviews
  the test, leaving consumer layouts permanently unreviewed. Est. effort: ~2h. Impact: visibility
  only.
- **C — Broaden the path conventions (Go `*_test.go`, Python/shell `test_*`, etc.).** Rejected: an
  open-ended per-ecosystem list that still drops the next layout silently, and it widens what
  rebase/autoresolve treat as test-only for every consumer. Est. effort: ~2-3h. Impact: partial.

Gate invalidation, rebase supersession excusal, and autoresolve conflict scoping stay path-only.
Treating a marker-bearing file outside the conventions as runtime source there is the conservative
direction: it can only invalidate more gates or refuse more automatic resolutions, never fewer.
