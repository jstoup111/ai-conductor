# Complexity: build_review / ci_watch partial-block preservation (#1002)

Tier: S

Rationale: Two adjacent normalizer blocks in a single file (`src/conductor/src/engine/config.ts`
lines 845–898) replace a valid object with `{ enabled: true }` whenever any non-`enabled` key is
present. The fix is per-key normalization inside those two blocks plus warning emission — no new
module, no new dependency, no schema/CLI/hook surface, no state machine, no integrations, no auth.
Both consumers (`engine/resolved-config.ts` → `engine/step-runners.ts`, and `engine/ci-fix.ts`)
already read the keys correctly with `??` defaults and need no change. Test surface is one existing
unit test file (`test/engine/config.test.ts`) plus a small consumer-reach assertion. Docs are two
already-written "Known limitation" callouts in `docs/reference/configuration.md` that become
obsolete. Matches the intake label `size: S`. Not Medium (single file's two sibling branches, no
integration seams, no architecture decision required).
