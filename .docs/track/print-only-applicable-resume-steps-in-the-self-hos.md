# Track: Self-host gate HALT resume procedure

Track: technical

Scope boundary: Small fix for #1775, approved by the operator on 2026-09-06 (delegated). Rewrite the shared resume procedure that the self-host gate HALT writer appends to every self-host finish-gate park, so that each printed step applies to a repository that builds itself, and correct the module header sentence that repeats the same instruction. Gate reasons, halt classification, the marker path, redaction, the daemon's re-dispatch behavior, and every other halt writer in the engine stay unchanged.

This is an operator-facing correction inside the self-host finish-gate plumbing; acceptance criteria live in technical stories rather than a PRD.

The operator delegated the wording decision on 2026-09-06. The chosen procedure drops the re-install step outright rather than substituting another maintenance command: the engine already relinks harness skills for a self-build before every dispatch, so no operator-run installer step is applicable at a gate HALT.

Scope check: A — harness-repo-only (the change lives under the engine's self-host directory, which is the canonical repo-only signal); B — n/a (no new skill); C — provider-agnostic (the halt body names no provider path, binary, or flag). No catalog registration is required. Event spine: no channel is added or changed — the halt marker is an existing operator-facing artifact and this change only rewrites prose already written into it.

Verified foundation: the shared writer builds the halt body from a caller reason plus a fixed three-step procedure whose second step tells the operator to re-install the harness and run a `/verify` command; its module header repeats that instruction. The repository ships no `/verify` skill — the closest name is the `verify-claims` protocol skill, which is unrelated to installation. The engine's install-freshness preflight already runs the harness installer in relink-only mode before dispatching any self-build, and the daemon's engine republish loop fetches, fast-forwards, and rebuilds the engine on its own, so the printed installer step is a no-op the operator is asked to perform by hand. The sibling rebase halt writer in the same engine directory already tells operators to clear both the halt marker and its class sidecar, which is also what the stalled-feature runbook's canonical resume procedure prescribes.
