# Complexity: Custom build_review rubrics run on every platform without an OS containment boundary

Tier: M

## Signals

| Signal | Reading |
|---|---|
| New data models | None — a digest record of the frozen review inputs is engine evidence under the existing build-review evidence root |
| External integrations | None new — existing Claude and Codex CLIs, now invoked in their read-only review modes |
| Auth / permissions | Reduced — the contained reviewer environment (scratch HOME, env allowlist) is retired; reviewers use the ordinary provider environment |
| State machines | None — the existing mechanical-fault lane and closed causes absorb a discarded verdict |
| Estimated stories | 4–6 |
| Surfaces touched | custom-policy lap dispatch in step-runners, both provider adapters' read-only mode, a digest-and-discard check, config load and `daemon status` capability report, ConductorEvent union, configuration docs; retirement of the bubblewrap review-containment module |

## Rationale

Above **S** because it amends an approved architecture decision
(adr-2026-09-10-portable-build-review-policy D5 requires a proven OS boundary with no prompt-only
fallback). It changes what the custom-review input guarantee means (prevented-and-detected writes
instead of OS-proven reads and writes), and it adds an up-front capability surface. Those are design
decisions, not plan tasks.

Below **L**: no new component, integration or state machine. The approach, detect-and-discard, was
settled in explore. The digest check and capability report reuse the existing evidence, event and
status seams. Most of the diff is retirement: the containment module, the reviewer env allowlist,
and the built-in-peer containment path in custom laps. The GitHub `size: L` label predates choosing
detect-and-discard over per-platform OS backends. Operator confirmed Tier M on 2026-09-24.
