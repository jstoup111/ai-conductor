# Track: GitHub issue text reaches an autonomous build with no inbound sanitization

Track: technical

Scope boundary: Balanced (B) — an inbound trust-boundary seam in `intake/` only: delimit issue-sourced text as untrusted at the ingestion choke point (`github-issues.ts` `buildText()`), neutralize directive-shaped content outside code fences with inert markers, and record every alteration on the event spine and in `compose claim` output. Applies to every writer to the path (human or automated filer). Excluded: any change to `--dangerously-skip-permissions` or build privilege (filed separately); the daemon build path, which consumes only merged specs.

Internal intake hardening with no product-facing capability; acceptance criteria live in stories.
