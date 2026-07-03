# Complexity: bin/conduct unknown-subcommand guard

Tier: S

## Rationale

- Single file touched (`bin/conduct`), single locus (the `while/case` argument loop, ~line 2807–2826), plus its test coverage in `test/`.
- No new models, integrations, external services, auth, or state machines.
- No data migration; behavior change is purely CLI argument validation + one `exec` forwarding path that already has an in-file precedent (`daemon` → `exec conduct-ts "$@"`).
- Expected story count: 3–4 (unknown flag rejection, conduct-ts subcommand forwarding, bare-word rejection with hint, multi-word feature description preserved).
- Condemned code path (v1.0 cutover #228 removes bin/conduct) — scope deliberately minimal.

Per tier S: skip /architecture-diagram, /architecture-review, and /conflict-check.
