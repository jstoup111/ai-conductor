# Implementation Plan: Claude remote-settings.json empty-to-{} refresh false-halts self-host builds (#3096)

**Date:** 2026-10-10
**Design:** technical track — no PRD; approach and rejected alternatives recorded in `.docs/track/claude-remote-settings-json-refresh-empty-false-ha.md`
**Stories:** `.docs/stories/claude-remote-settings-json-refresh-empty-false-ha.md`
**Conflict check:** skipped per Tier S (`.docs/complexity/claude-remote-settings-json-refresh-empty-false-ha.md`)

## Summary

Stop Claude's remote-settings refresh (root `remote-settings.json` flipping between zero bytes and
`{}`) from false-halting self-host builds, while real managed-settings content changes, creation,
and deletion of that file still halt and name it. 4 tasks, one engine module plus its test file.

## Technical Approach

- **Normalize, do not exclude.** CLAUDE.md daemon rule 5 forbids widening the exclusion lists, and
  the issue's desired outcomes require the file to stay visible. The file therefore stays in the
  provider-state manifest; only its digest is canonicalized when its content is semantically empty.
  Because the entry is still emitted whenever the file exists, `diffManifests` still reports
  `added`/`removed`, and any non-empty content keeps its raw sha256 digest and reports `changed`.
- **Per-provider path table.** `src/conductor/src/engine/self-host/live-boundary.ts` gains a
  `Readonly<Record<SelfHostProviderId, readonly string[]>>` table of provider-state-root paths whose
  semantically empty JSON content is one fingerprint state, mirroring the existing
  `PROVIDER_STATE_VOLATILE` / `PROVIDER_STATE_VOLATILE_DIRECTORY_BASENAMES` shape: Claude lists
  exactly `remote-settings.json`; Codex and Pi list nothing. Matching is exact root-relative path
  equality (no prefix, segment, or basename match), so `rules/remote-settings.json` is untouched.
- **Where the digest happens.** `manifest(root, exclude, excludeDirectoryBasenames, semanticEmptyJson = [])`
  gains the fourth parameter. When an entry's root-relative path is in that list and
  `entryContent` returned a Buffer, a small pure helper decides semantic emptiness: the UTF-8 text
  trims to empty, or `JSON.parse` succeeds and yields a non-null, non-array object with zero own
  keys. Invalid JSON, `[]`, `null`, scalars, and any object with keys are not empty and keep the raw
  digest. A semantically empty entry digests a fixed sentinel string (for example
  `semantic-empty-json`) instead of the bytes.
- **Snapshot carries the table.** `Surface` gains optional `semanticEmptyJson`; `fingerprintLiveBoundary`
  sets it on the provider-state surface only (`[]` when no provider is given) and never on the live
  checkout surface; `verifyLiveBoundary` passes `surface.semanticEmptyJson ?? []` to `manifest` so
  baseline and re-check normalize identically. The halt-reason format and `describeDiff` are
  unchanged.
- **Entry point.** `fingerprintLiveBoundary` and `verifyLiveBoundary` are the exported functions the
  self-host dispatch path calls before and after every dispatch; Task 1 owns the integration proof
  through them. Tests follow the existing pattern in
  `src/conductor/test/engine/self-host/live-boundary.test.ts` (search `policy-limits fetch stamp`):
  `mkdtemp` a root with `live/` and `provider/` dirs, `fingerprintLiveBoundary({ liveCheckout,
  unrelatedProviderState, provider })`, mutate with `writeFile`/`rm`, then `verifyLiveBoundary(baseline,
  { contained: false, reason: '...' })`, cleaning up in `finally`. Live-checkout git cases follow
  `halts an untracked live-checkout dispatch leak when containment is unproven` (`git init` via
  `execFileAsync`). Add the new tests in one `describe('Claude remote-settings.json semantic-empty
  equivalence (#3096)')` block; update the file's `// Covers:` header only if that convention
  requires it.

## Prerequisites

- None.

## Tasks

### Task 1: Canonicalize semantically empty Claude remote-settings.json digests
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/live-boundary.test.ts` using the
   `policy-limits fetch stamp` test's mkdtemp/fingerprint/verify shape with `provider: 'claude'`:
   zero bytes to `{}`; `{}` to zero bytes, to `{}` plus a newline, and to whitespace only (fresh
   baseline per rewrite or one baseline verified after each); and an unchanged non-empty object.
2. Verify the first two fail (RED): pre-change, both report `changed remote-settings.json`.
3. Implement in `src/conductor/src/engine/self-host/live-boundary.ts`: the per-provider
   semantic-empty JSON path table (Claude: `remote-settings.json`; Codex and Pi: empty), the pure
   emptiness helper, the `manifest` parameter and sentinel digest, `Surface.semanticEmptyJson`, and
   its use in `fingerprintLiveBoundary` (provider surface only) and `verifyLiveBoundary`. Add the
   source comment beside `CLAUDE_PROVIDER_STATE_VOLATILE` citing #3096 and the two 2026-10-10 halts,
   explaining that the file is policy config like `policy-limits.json` and is normalized, not
   excluded. Do not add any entry to `PROVIDER_STATE_VOLATILE`, `LIVE_CHECKOUT_VOLATILE`, or either
   directory-basename table.
4. Verify GREEN, including the existing exhaustive-table test unchanged.
5. Commit: "fix(self-host): treat empty and {} Claude remote-settings.json as one fingerprint state (#3096)"

**Done when:**
- [test] a live-boundary test fingerprints a Claude provider home (`provider: 'claude'`) with a zero-byte root `remote-settings.json`, rewrites it to `{}`, and asserts `verifyLiveBoundary` returns `{ ok: true }`
- [test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` is `{}` and asserts `verifyLiveBoundary` returns `{ ok: true }` after each rewrite to zero bytes, to `{}` plus a newline, and to whitespace only
- [test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` holds a non-empty managed-settings object (one top-level `permissions` key), leaves it unchanged, and asserts `verifyLiveBoundary` returns `{ ok: true }`
- `manifest` in `src/conductor/src/engine/self-host/live-boundary.ts` gives the Claude provider-state root `remote-settings.json` one canonical digest only when its content is zero bytes, whitespace only, or JSON parsing to a non-array object with no keys, and the existing exhaustive `PROVIDER_STATE_VOLATILE` table test passes unmodified
- the source comment beside `CLAUDE_PROVIDER_STATE_VOLATILE` names `remote-settings.json`, cites #3096, and states that the file is normalized rather than excluded so managed-settings content stays fingerprinted

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — semantic-empty table, helper, manifest digest, surface field
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — happy-path equivalence tests

**Dependencies:** none

### Task 2: Real managed-settings content changes still halt
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in the same describe block, same fixture shape, `provider: 'claude'`: `{}` to a
   non-empty object; a non-empty object to `{}` and (fresh baseline) to zero bytes; `{}` to the
   invalid JSON `{`, to `[]`, and to `null`, each from a fresh baseline.
2. Run them; if any passes `ok: true`, fix the emptiness helper from Task 1 so only zero bytes,
   whitespace, or a key-less non-array object count as empty.
3. Verify GREEN.
4. Commit: "test(self-host): non-empty remote-settings.json changes still halt (#3096)"

**Done when:**
- [test] a live-boundary test rewrites a Claude root `remote-settings.json` from `{}` to a non-empty managed-settings object (one top-level `permissions` key) and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `provider state changed during self-host execution` and `changed remote-settings.json`
- [test] a live-boundary test rewrites a Claude root `remote-settings.json` holding a non-empty object to `{}` and, from a fresh baseline, to zero bytes, and asserts each verification returns `ok: false` with a provider-state reason containing `changed remote-settings.json`
- [test] a live-boundary test rewrites a Claude root `remote-settings.json` from `{}` to the invalid JSON `{`, to `[]`, and to `null`, from a fresh baseline each time, and asserts each verification returns `ok: false` with a reason containing `changed remote-settings.json`

**Files likely touched:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — content-change negative tests

**Dependencies:** Task 1

### Task 3: Creating or deleting remote-settings.json stays visible
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in the same describe block, `provider: 'claude'`: no file at baseline then a
   zero-byte file, and (fresh baseline) a `{}` file; `{}` at baseline then `rm` of the file.
2. Run them; if an addition or removal is masked, fix Task 1's manifest change so the entry is
   still emitted whenever the file exists and only its digest is canonicalized.
3. Verify GREEN.
4. Commit: "test(self-host): remote-settings.json creation and deletion still halt (#3096)"

**Done when:**
- [test] a live-boundary test fingerprints a Claude provider home with no `remote-settings.json`, creates a zero-byte one and, from a fresh baseline, a `{}` one, and asserts each verification returns `ok: false` with a provider-state reason containing `added remote-settings.json`
- [test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` is `{}`, deletes it, and asserts `verifyLiveBoundary` returns `ok: false` with a provider-state reason containing `removed remote-settings.json`

**Files likely touched:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — added/removed negative tests

**Dependencies:** Task 1

### Task 4: Normalization is scoped to the Claude provider-state root file
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in the same describe block: Claude home `rules/remote-settings.json` `{}` to zero
   bytes; Codex home (`provider: 'codex'`) root `remote-settings.json` `{}` to zero bytes; a
   `git init` live checkout with untracked root `remote-settings.json` `{}` under `provider:
   'claude'`, rewritten to zero bytes and verified with `contained: false`.
2. Run them; if any passes, fix Task 1 so matching is exact root-relative equality, only the Claude
   table entry is populated, and only the provider-state surface carries the table.
3. Verify GREEN.
4. Commit: "test(self-host): remote-settings.json normalization is Claude-root-only (#3096)"

**Done when:**
- [test] a live-boundary test fingerprints a Claude provider home whose `rules/remote-settings.json` is `{}`, rewrites it to zero bytes, and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `changed rules/remote-settings.json`
- [test] a live-boundary test fingerprints a Codex provider home (`provider: 'codex'`) whose root `remote-settings.json` is `{}`, rewrites it to zero bytes, and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `changed remote-settings.json`
- [test] a live-boundary test fingerprints a git-initialized live checkout with an untracked root `remote-settings.json` of `{}` under `provider: 'claude'`, rewrites it to zero bytes, verifies with `{ contained: false, reason: ... }`, and asserts `ok: false` with a reason containing `live checkout changed during self-host execution`, `changed remote-settings.json`, and `Containment was not in force`

**Files likely touched:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — scope negative tests

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬─> Task 2
         ├─> Task 3
         └─> Task 4
```

## Integration Points

- After Task 1: a Claude remote-settings refresh no longer halts a self-host dispatch through
  `fingerprintLiveBoundary`/`verifyLiveBoundary`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Claude provider-state home whose root `remote-settings.json` is zero bytes at fingerprint time, when the file is rewritten to `{}` before verification, then `verifyLiveBoundary` returns ok with no provider-state halt | 1 | "[test] a live-boundary test fingerprints a Claude provider home (`provider: 'claude'`) with a zero-byte root `remote-settings.json`, rewrites it to `{}`, and asserts `verifyLiveBoundary` returns `{ ok: true }`" | diff-local |
| Story 1 happy: Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to zero bytes, or to `{}` followed by a newline, or to whitespace only, before verification, then `verifyLiveBoundary` returns ok with no provider-state halt | 1 | "[test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` is `{}` and asserts `verifyLiveBoundary` returns `{ ok: true }` after each rewrite to zero bytes, to `{}` plus a newline, and to whitespace only" | diff-local |
| Story 1 happy: Given a Claude provider-state home whose root `remote-settings.json` holds managed settings content at fingerprint time, when the file is left unchanged, then `verifyLiveBoundary` returns ok | 1 | "[test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` holds a non-empty managed-settings object (one top-level `permissions` key), leaves it unchanged, and asserts `verifyLiveBoundary` returns `{ ok: true }`" | diff-local |
| Story 1 negative: Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to a non-empty object such as `{"permissions":{"deny":["Bash"]}}`, then verification fails with a provider-state reason naming `changed remote-settings.json` | 2 | "[test] a live-boundary test rewrites a Claude root `remote-settings.json` from `{}` to a non-empty managed-settings object (one top-level `permissions` key) and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `provider state changed during self-host execution` and `changed remote-settings.json`" | diff-local |
| Story 1 negative: Given a Claude provider-state home whose root `remote-settings.json` holds a non-empty object at fingerprint time, when the file is rewritten to `{}` or to zero bytes, then verification fails with a provider-state reason naming `changed remote-settings.json` | 2 | "[test] a live-boundary test rewrites a Claude root `remote-settings.json` holding a non-empty object to `{}` and, from a fresh baseline, to zero bytes, and asserts each verification returns `ok: false` with a provider-state reason containing `changed remote-settings.json`" | diff-local |
| Story 1 negative: Given a Claude provider-state home with no `remote-settings.json` at fingerprint time, when an empty or `{}` `remote-settings.json` is created before verification, then verification fails with a provider-state reason naming `added remote-settings.json` | 3 | "[test] a live-boundary test fingerprints a Claude provider home with no `remote-settings.json`, creates a zero-byte one and, from a fresh baseline, a `{}` one, and asserts each verification returns `ok: false` with a provider-state reason containing `added remote-settings.json`" | diff-local |
| Story 1 negative: Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is deleted before verification, then verification fails with a provider-state reason naming `removed remote-settings.json` | 3 | "[test] a live-boundary test fingerprints a Claude provider home whose root `remote-settings.json` is `{}`, deletes it, and asserts `verifyLiveBoundary` returns `ok: false` with a provider-state reason containing `removed remote-settings.json`" | diff-local |
| Story 1 negative: Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to content that is not valid JSON, or to JSON that is not an object such as `[]` or `null`, then verification fails naming `changed remote-settings.json` | 2 | "[test] a live-boundary test rewrites a Claude root `remote-settings.json` from `{}` to the invalid JSON `{`, to `[]`, and to `null`, from a fresh baseline each time, and asserts each verification returns `ok: false` with a reason containing `changed remote-settings.json`" | diff-local |
| Story 1 negative: Given a Claude provider-state home with a nested lookalike such as `rules/remote-settings.json` that is `{}` at fingerprint time, when that nested file is rewritten to zero bytes, then verification fails naming that nested path | 4 | "[test] a live-boundary test fingerprints a Claude provider home whose `rules/remote-settings.json` is `{}`, rewrites it to zero bytes, and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `changed rules/remote-settings.json`" | diff-local |
| Story 1 negative: Given a Codex provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to zero bytes, then verification fails naming `changed remote-settings.json` | 4 | "[test] a live-boundary test fingerprints a Codex provider home (`provider: 'codex'`) whose root `remote-settings.json` is `{}`, rewrites it to zero bytes, and asserts `verifyLiveBoundary` returns `ok: false` with a reason containing `changed remote-settings.json`" | diff-local |
| Story 1 negative: Given a live checkout whose root `remote-settings.json` is untracked and `{}` at fingerprint time with containment unproven, when it is rewritten to zero bytes, then verification fails as unexplained live-checkout drift | 4 | "[test] a live-boundary test fingerprints a git-initialized live checkout with an untracked root `remote-settings.json` of `{}` under `provider: 'claude'`, rewrites it to zero bytes, verifies with `{ contained: false, reason: ... }`, and asserts `ok: false` with a reason containing `live checkout changed during self-host execution`, `changed remote-settings.json`, and `Containment was not in force`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
