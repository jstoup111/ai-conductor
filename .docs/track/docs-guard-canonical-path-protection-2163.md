# Track: Docs guard canonical path protection

Track: technical

Source-Ref: jstoup111/ai-conductor#2163

Scope boundary: Protect .docs writes through alternate project-root spellings, path components and symlinks while retaining non-.docs pass-through, existing allow-prefix policy and the inactive-marker fast path. The operator explicitly approved option A on 2026-09-05: both the requested lexical path and resolved destination must satisfy existing .docs protection/allowlist rules. Do not broaden this into a new hook surface, arbitrary outside-workspace prohibition, provider-parity redesign, runtime dependency installation, or general sandbox. This PR authors specs only.

Approach: canonicalize inside the existing generated hook's Node boundary and apply the current policy to both path interpretations. The selected state is the conjunction of their permissions: any protected, non-allowlisted interpretation blocks. This is S, roughly 1–2 hours; it fixes the existing write classifier at the point of mutation. An alternative single physical-path classifier is equally small but would allow a lexical protected .docs path to escape via an outward symlink; the operator rejected that option by selecting both interpretations. A new external realpath dependency or repository runtime CLI per tool call adds packaging/latency without improving this outcome and is unnecessary because the hook already uses Node.

Scope check: A — consumer-facing hook correction, installed into consumer projects as well as this repository. B — n/a, no skill. C — provider mechanics scoped: this existing Claude PreToolUse hook remains early feedback; Codex and Claude retain the existing provider-neutral pre-commit and terminal protected-artifact gates. No new host capability is claimed. Registration: regenerate the committed hook from session-hook-assets.ts; no settings wiring or new dependency.

Verified: DOCS_GUARD_HOOK strips only literal PWD before matching .docs, so an alternate absolute spelling remains outside both protected case arms. It already denies an undeterminable target when phase-active exists, allows non-.docs paths, and uses Node for bounded payload parsing. The approved phase-scoped docs write guard and later provider-neutral commit-gate decision retain this hook as early feedback. The user resolved the sole policy ambiguity; verify-claims verdict CLEAR.
