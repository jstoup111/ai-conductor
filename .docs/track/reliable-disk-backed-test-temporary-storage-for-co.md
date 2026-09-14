# Track: Reliable test temporary storage

Track: technical

Scope boundary: Placement plus preserved protections, confirmed by the operator selecting option 1 on 2026-09-11. Move this repository's test temporary storage away from the default /tmp location, allow an explicit override, and preserve run isolation, cleanup, stale-root retention rules, and leak detection. Excludes storage quotas, capacity admission checks, concurrency throttling, and fixture-by-fixture cleanup work.

Technical track and Small classification confirmed by the operator with “aligned” on 2026-09-11. This is repository-local test infrastructure, not an installed consumer capability. Source: jstoup111/ai-conductor#2224.

Scope-check: A = harness-repo-only (the affected Vitest infrastructure exists only here); B = not applicable (no new skill); C = provider-agnostic (filesystem and test startup behavior shared by every host).

Verified context: scripts/run-vitest.mjs and both Vitest configs currently allocate through os.tmpdir(); test/global-setup.ts derives the original temporary directory from the run root's parent. Paths above are relative to src/conductor/. Relocation must preserve the original directory independently so leak detection does not silently change its observation target.

The operator selected relocation over capacity controls and retaining the current location with reduced concurrency. On 2026-09-11 the operator approved checkout-local ignored storage, an explicit override, startup failure rather than silent fallback when storage is invalid or unavailable, and preservation of cleanup and leak detection. The operator additionally required project-specific code and execution to remain outside project-agnostic surfaces: implementation belongs in this repository's Vitest configs, scripts, and test support; do not add this policy to shared engine code, installed skills, or HARNESS.md.
