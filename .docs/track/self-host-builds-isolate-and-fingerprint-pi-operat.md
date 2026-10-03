# Track: Self-host builds isolate and fingerprint Pi operator state

Track: technical

Scope boundary: Balanced. Pi gains the selfHost capability: an isolated Pi home (PI_CODING_AGENT_DIR), a Pi-resolved single credential in that home (the engine runs `pi auth print-api-key --provider <p>` for the dispatched candidate's provider against the operator's live Pi home and writes a one-entry auth.json, mode 0600, into the isolated home), a Pi provider-state volatile list for the live-boundary fingerprint, scrubbing of every built-in provider home variable plus PI_CODING_AGENT_SESSION_DIR from the child environment, scratch leak-sweep parity, and replacement of the conductor's claude/codex branches (provider-home selection, selected auth paths, Claude-only build-auth and credential preflights) with catalog-declared fields so Pi never reaches Claude-only preflights. Excluded: copying the whole auth.json, engine-side parsing of auth.json entries, symlinked auth, extension- or package-registered Pi providers (refused at setup), isolation of the HOME-relative ~/.agents/skills root, and tightening the bwrap containment so the build cannot read the operator home.

Internal build-isolation machinery for an existing provider; no user-facing capability, so acceptance criteria live in stories with no PRD.
