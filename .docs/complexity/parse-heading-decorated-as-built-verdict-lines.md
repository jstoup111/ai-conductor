# Complexity: Parse heading-decorated as-built verdict lines

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change widens one existing regex, lifts it into a dependency-free module so the engine has a
single verdict-line reader, and points the two duplicate readers at it. No new step, gate, event,
metric, artifact, configuration key, CLI surface, hook, schema, or skill is introduced, and no
approved architecture decision is amended: the closed vocabulary, the fail-closed invalid causes,
and the routing that consumes them are untouched. Four production files change, each by a few lines,
and the behavior is provable at the pure-function seam plus two existing bounded fixtures.
Small-tier architecture, conflict-check, and coherence artifacts are not required.
