# Track: Daemon session command compatibility and visibility

Track: technical

Source-Ref: jstoup111/ai-conductor#2709

Scope boundary: All three operator-confirmed outcome groups: a pre-merge check of engine-rendered and skill-directed daemon command compatibility, with interactive-only instructions distinguished; runtime guard refusal reporting on the event spine and daemon log; and operator visibility for GitHub mutations performed outside the guarded path. The operator confirmed this scope and ai-conductor routing, then approved Approach A and the technical track in chat on 2026-10-01.

> **Amended 2026-10-01 by #2709:** The operator accepted bounded GitHub observation with “fine” in response to the explicit coverage choice. The bypass outcome covers ordinary PATH-resolved gh calls, including child scripts inheriting that environment. Absolute binary paths, replaced PATH, custom HTTP/SDK clients, and separate MCP transports are outside coverage. The other outcome groups remain in full scope. This accepts a monitoring boundary, not a new authorization exemption or automatic blocking policy.

This is internal tooling and execution-boundary correctness. Acceptance criteria belong in technical stories; no product PRD is required.

## Selected approach

Audit the existing instruction sources against the production session guard, preserving explicit execution-context distinctions. Add runtime occurrence reporting through the existing event spine. Do not migrate all command prose to a generated catalog.

Alternative considered: generate command instructions from a shared catalog. It offers stronger construction-time consistency but requires a broader prompt/skill migration than the selected Medium change. The operator selected the existing-source audit.

The audit must not become a second allowlist or grant permissions merely because a prompt asks for a command. Existing mismatches need explicit resolution under their governing architecture.

## Scope and placement

A. Audience: mixed. The pre-merge validation belongs to this repository; runtime reporting applies to installed harness daemon sessions, not only self-host builds. Scope-check's daemon heuristic alone would call this repository-only; the deciding mechanism-exists-outside-this-repository test makes the runtime portion shared.
B. Catalog: n/a. No skill is introduced.
C. Provider: agnostic. Every supported provider's managed-session boundary must satisfy the same outcome; a provider-specific hook alone is insufficient.
Registration: existing repository validation entry point, existing runtime event union and sink declarations, affected runtime/operator documentation. No new skill catalog/model-table entries.

## Verify-claims ledger

- [verified] The source issue requests all three outcome groups above; its complete Desired outcome is staged in .pipeline/intake-outcomes.md.
- [verified] execution/daemon-session.ts admits github-operation but omits finish-record.
- [verified] engine/conductor.ts buildRetryHint emits an ai-conductor finish-record instruction for missing recording.
- [verified] index.ts main currently prints the guard refusal and returns before command dispatch.
- [verified] engine/github-invocation-audit.ts already audits executable GitHub publication boundaries; it does not establish daemon command compatibility.
- [confirmed] Operator chose all requested outcomes, Approach A, technical track and the proposed Medium scope.
- No unconfirmed assumption is being used to settle runtime interception, command permission changes, or audit-context syntax; these remain architecture-review decisions.

Verdict: CLEAR for track and selected approach.
