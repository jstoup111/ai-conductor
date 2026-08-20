# Track: Implementation drifts from local patterns and over-tests behavior

Track: technical

Scope boundary: Comprehensive across the shared pattern-first and lowest-sufficient-test-layer rules and every relevant non-`build_review` lifecycle surface. Reuse concrete existing patterns per feature without defining strict universal style guidance. Keep #1552's tests minimal: do not assert skill wording; test only machine-readable or executable behavior introduced by this feature at its narrowest sufficient seam. Exclude project-owned convention configuration (intake #1554), the repository-wide cleanup of existing skill-language assertions (intake #1555), all `build_review` prompt/rubric/verdict/runner changes (intake #1553), and any new skill.

This changes the internal SDLC authoring, implementation-context, and testing contracts without adding an end-user product capability; acceptance criteria belong directly in technical stories.
