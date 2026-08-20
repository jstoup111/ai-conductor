# Complexity: first-run-install-silently-defaults-the-update-cha

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None — a four-source precedence resolution evaluated once, not a machine with states |
| Story count | 5 (flag supply, env fallback, invalid value rejected, configured channel never re-prompted, resolved channel confirmed) |
| Files touched | `bin/install` (one function + the existing option-stripping loop + help text), one new acceptance test, `docs/reference/cli.md` + `docs/reference/environment.md` + `docs/quickstart.md` |
| New runtime code | Bash only — no TypeScript, no engine surface, no config schema change (`updateChannel` already exists) |

## Rationale

The change is additive and local to a single installer function. `bin/install` already carries the
exact pattern this needs: `--providers` / `--providers=` is stripped in the pre-dispatch option
loop, validated against a closed set before any global installation begins, and fails with a named
error on an unsupported value. This work copies that shape for `--channel`, adds a
`CONDUCTOR_CHANNEL` read, and reorders `configure_conductor`'s first-run arm to consult them before
prompting. `test/test_install_provider_readiness.sh` supplies a directly reusable acceptance harness
(disposable checkout, `FAKE_HOME`, PATH stubs, pty-driven prompt), so the test is an adaptation
rather than new infrastructure.

No config schema changes — `updateChannel` is an existing key with existing readers
(`bin/update:322`, `bin/conduct:319`) that this work does not touch. No new integrations, models,
auth surface, or engine code. → **Small.** `/architecture-diagram`, `/architecture-review`,
`/conflict-check`, and `/coherence-check` are skipped for this tier.
