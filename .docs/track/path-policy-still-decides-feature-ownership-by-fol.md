# Track: Path policy decides feature ownership from the artifact manifest (#3418, spec 2 of 3 for #3405)

Track: technical

Scope boundary: Spec 2 of the three-spec split in `adr-2026-10-24-per-feature-artifact-manifest`
decision 10, operator-confirmed 2026-10-28 at full breadth: all six desired outcomes of #3418. The
engine computes one ownership result for a manifest-backed feature (the listed paths plus the
manifest itself, or malformed, or drift naming each disagreeing path) at every BUILD/SHIP step entry
and at land. The protected-artifact seal, the pre-commit hook, the BUILD docs write allowlist, gate
invalidation, rebase handling, retention/prune and build_review scope consume that result instead of
folder and basename matching. A change to `.docs/<slug>/manifest.json` by any tool, including Bash,
is refused at commit or stops the run at the next step boundary, naming the manifest. Manifest and
file disagreement stops the run naming each path. A TTY-only operator command registers an in-scope
artifact added after land. Prune removes a pruned feature's manifest with its prunable files. Specs
without a manifest, and consumer repositories, behave exactly as today under every policy.

Out of scope: moving any artifact file or changing the layout and content (spec 3); interactive
`conduct` manifest registration (spec 3, assumption A3 of the manifest ADR); the step-completion
lone-artifact fallback (#3338), which stays its own issue; Codex PreToolUse parity for the docs
write guard (#1353).

Rationale: once spec 3 moves files under `.docs/<slug>/`, every folder-matched policy would silently
stop protecting or scoping them, and the manifest is unprotected and can drift from its files today.
