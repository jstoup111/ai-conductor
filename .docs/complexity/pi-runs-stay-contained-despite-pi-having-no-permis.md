# Complexity: Pi runs stay contained despite Pi having no permission model

Tier: M

Rationale: There is no new subsystem. The work extends seams that already exist:
- The Pi catalog descriptor declares the `readOnlyReview` capability, which #1884 reserved for this intake.
- The Pi adapter argv gets a read-only review mode: `--tools` allowlist, `--no-extensions`, and `-e` pointing at a harness extension. It also gets `-na` on every dispatch.
- A new shipped asset: a harness-owned Pi extension that registers a structured, shell-free `git_read` tool. It is loaded by Pi, not by the engine.
- One additive config sub-key, `llm_providers.pi.trust_project_files`, extending #1885's `llm_providers` block.
- The Pi env is brought to the codex treatment: daemon-session marker and tmux scrub.
- Environment-claim-audit test coverage for Pi.

That is roughly 6-8 production files and 8-12 tasks. It is above Small because it ships a new cross-process asset: a TypeScript extension running inside Pi's runtime, whose tool contract must hold read-only by construction. It also enrolls a third provider in custom-policy build_review admission. It is not Large: no ADR-level seam is replaced, and OS write-containment is deferred to #2851.
