# Track: No operator command to reseal a protected DECIDE artifact (#1281)

Track: technical

Operator-only recovery tooling over an internal tamper-detection boundary
(`src/conductor/src/engine/protected-artifact-seal.ts`, `.pipeline/protected-artifact-seal.json`,
`.pipeline/HALT`). The new `conduct reseal` verb is a harness operator escape hatch in the same
class as `decide-grant`, not an end-user product capability: there is no product behavior, no
config semantics, and no end-user-perceived surface. Every acceptance signal is mechanical — an
exit code, the resulting seal JSON, the `rebaselines[]` audit entry, the emitted event, and the
HALT file state — so acceptance criteria live directly in the stories and no PRD is authored.

Precedent: `.docs/track/2026-07-27-protected-artifact-seal-self-amendment-1047.md`,
`.docs/track/build-halts-when-a-branch-inherits-an-older-revisi.md`,
`.docs/track/codex-lacks-preventive-hook-parity-protected-artif.md`, and
`.docs/track/bin-conduct-unknown-subcommand-guard.md` (also a new CLI verb) are all technical.

Source: jstoup111/ai-conductor#1281.
