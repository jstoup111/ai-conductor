# Track: Pi as a build provider

Track: technical

Scope boundary: Foundation only — Pi built-in adapter (one-shot `pi -p --no-session --mode json`), registration, config validation, candidate-fallback participation, classified failure signals, fake-backed default tests, docs. Boot-time provider discovery: the daemon/engine detects which built-in providers are installed (executable resolvable via its `*_EXECUTABLE` override or PATH and `--version` exits 0), registers only those, and refuses to start when any configured provider (run-level, per-step, or fallback entry) is not installed, with an error naming the provider and step that is distinct from the unknown-provider error. Replace every hardcoded two-provider (`claude`/`codex`) list or union with a single provider registry/constant as the source of truth. Excluded: self-host isolation (#1887), containment (#1886), model selection (#1885), skills/context (#1888), telemetry/cost (#1889), e2e/smoke parity (#1890).

Internal provider infrastructure with no user-facing product requirements; acceptance lives in stories.
