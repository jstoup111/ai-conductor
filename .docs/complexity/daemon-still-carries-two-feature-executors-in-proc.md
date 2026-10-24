# Complexity: Retire the in-process feature executor (#3333)

Tier: M

## Rationale

- No new models, integrations, dependencies, or contract surface: the change deletes the
  in-process adapter (`engine/feature-executor.ts`), the `executor_isolation` selection in
  `daemon-cli.ts`, and the key from `types/config.ts` / `engine/config.ts`. The key never shipped
  in a release (absent from v1.6.0), so no migration or waiver.
- Not a leaf fix: it replaces the daemon-cli `opts.runFeature` composition-test bypass with an
  injectable child-executor `fork` seam, which reshapes the composition boundary roughly a dozen
  daemon test files depend on, and retargets the six test files that pinned `in-process` onto the
  production child path.
- Amends an APPROVED ADR (`adr-2026-10-15-per-dispatch-engine-pinned-executor.md`): its
  two-adapter consequence and rollback-lever decision text no longer hold, and its follow-up action
  closes. Warrants a lightweight architecture review, not a full one.
- Story count small (~4: single execution path, key rejected as unknown, daemon tests exercise the
  child path, docs/ADR describe only the child executor).
- Estimated effort ~1 day (matches intake `size: M` label).

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check + coherence-check
required; stories + plan as always.
