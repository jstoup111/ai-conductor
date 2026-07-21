# Intake marker: intake-only criteria enforcement

Source-Ref: jstoup111/ai-conductor#695

Routed to `ai-conductor`. Spec authored under the operator directive
**"No failures — enforce requirements at intake ONLY."**

- Requirements (priority label, size label, dependency-linking) are satisfied at
  intake **capture/file time** so every intake entry is born complete.
- **Zero new downstream failure modes**: no pipeline gate, no HALT, no
  build/dispatch rejection, no CI failure for missing priority/size/links.

Supersedes the prior spec on PR #696 (`intake-criteria-enforcement`), which
enforced at **claim time** (a `needs-criteria` dispatch deferral) — a new
downstream stall the directive forbids. See
`.docs/decisions/adr-2026-07-21-intake-only-enforcement.md`.
