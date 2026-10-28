# Track: Land manual changes in the stacked child that owns them, and rewind closed children

Track: technical

Scope boundary: an operator-driven route round on the shipped routed-repair machinery
(`adr-2026-10-12-routed-whole-feature-repair`). A guarded `ai-conductor stack land` CLI opens the
round on a named closed child, records the person's declaration that the change is complete, or
abandons it. While any route round is open, the commit hook refuses commits on every branch of the feature
but the host, whether or not they carry a `Task:` trailer, and still allows halt-record-only commits. The
stack preflight halts rather than closing over an undeclared round. After the declaration, the
child's region re-validates the change (acceptance verify-green, `test_suite`, `build_review` against
the pinned closure base), repairs failures inside that child under its caps, and leaves through the
routed exit restack, the re-validation queue and the leaf whole-feature gates. `rewind --child <k>`
on a closed child opens the same kind of round instead of refusing. A durable per-feature dispatch lease with process liveness excludes the daemon and every other
writer while an operator command mutates the feature (operator decision 2026-10-24). A landing
refuses to start while a route round, the re-validation queue or a restack journal is open; it parks
the feature itself, and the round releases only a park it took. With routing on, a
raw commit past a closed child's closure made outside any landing halts the preflight instead of
being auto-restacked, and `stack land --child <k> --carry <j>…` carries it into a round (operator
decision 2026-10-24). Automatic co-origins during routed rounds are retired the same way. A thin shipped skill judges which child owns a change and drives the CLI. Builds on
#3365 (`adr-2026-10-23-slice-topology-from-sealed-plan`), reading slice topology through its loader.
Excluded: published stacks. On a stack with an active publication record, `stack land` and the
closed-child rewind refuse up front and name #3268, which owns refreshing and adopting a published
stack. Also excluded: reviewer PR comments (#3269), and per-child custom steps (#2947). N=1 features and
unsliced plans behave exactly as today.

Engine-internal stacked-delivery machinery plus an operator CLI and skill; no product requirements
worth a PRD. Acceptance criteria live in stories.
