# Plan: GitHub issue ↔ PR linkage + auto-close

**Spec:** .docs/specs/intake-issue-pr-link-autoclose.md
**Stories:** .docs/stories/intake-issue-pr-link-autoclose.md
**Tier:** M

## Architecture note (lightweight)

No new components or state machines. One new committed artifact (`.docs/intake/<slug>.md`)
acts as the carrier that lets the issue origin survive the spec-PR merge so the daemon can
reach it. Two new deterministic, idempotent, non-fatal `gh` body edits (one per PR kind).
Everything is gated on a parseable `sourceRef`; absent → today's behavior, byte-for-byte.

## Task Dependency Graph

```
T1 (shared issue-ref helper)
 ├─► T2 (landSpec writes intake marker)      ─┐
 ├─► T3 (runAuthoring writes intake marker)   ├─► T6 (daemon-backlog reads marker → BacklogItem.sourceRef) ─► T7 (daemon-cli: Closes on impl PR)
 ├─► T4 (openSpecPr injects Refs on spec PR) ─┘
 └─► T5 (artifacts.ts parseIntakeSourceRef)  ─────────────────────────────────────────────► T6
T8 (docs + CHANGELOG + VERSION)  depends on T1–T7
```

## Tasks

### T1 — Shared issue-ref helper  (covers FR-2/4/6/7)
New `src/conductor/src/engine/engineer/issue-ref.ts`:
- `parseSourceRef(ref): { repo, number } | null` — lift the existing private impl from
  `github-issues.ts` and re-export from there to avoid duplication.
- `formatIssueRef(keyword, sourceRef): string | null` → e.g. `"Closes acme/app#49"`; null if unparseable.
- `injectIssueRef({ gh, prUrl, keyword, sourceRef, cwd, log })`: `gh pr view --json body`;
  if body already contains the formatted line → no-op (idempotent); else
  `gh pr edit <url> --body "<body>\n\n<line>"`. try/catch → log + return (non-fatal).
- Unit tests: parse table (valid/garbled), idempotency, non-closing-vs-closing keyword,
  gh-failure non-fatal.

### T2 — `landSpec` writes the intake marker  (FR-1)
`land-spec.ts`: add optional `sourceRef` param. After `slug` is derived and before
`git add .docs`, when `parseSourceRef(sourceRef)` is non-null, write
`.docs/intake/<slug>.md` containing `Source-Ref: <sourceRef>\n` (guarded via AuthoringGuard).
Wire `engineer land --source-ref` → `landSpec(..., sourceRef)` in `engineer-cli.ts`.
Tests: marker written for valid ref; no marker for absent/garbled ref; commit still clean.

### T3 — `runAuthoring` writes the intake marker  (FR-1)
`authoring.ts`: same marker write in the autonomous path, alongside the complexity marker,
guarded, before commit. Add optional `sourceRef` to `RunAuthoringDeps`/signature and thread
from its caller. Tests mirror T2.

### T4 — Spec PR gets a non-closing `Refs`  (FR-2)
`handoff.ts`: `HandoffDeps` gains optional `sourceRef`. After a successful `pr-opened`,
call `injectIssueRef({ keyword: 'Refs', ... })`. Keep `--fill` create path unchanged.
`engineer-cli.ts` handoff: pass `sourceRef` into `openSpecPr` deps.
Tests: Refs injected when ref present; no closing keyword ever; none when absent; idempotent;
gh failure returns the opened PR.

### T5 — Daemon-side parse helper  (FR-3)
`artifacts.ts`: `parseIntakeSourceRef(content: string | null): string | undefined` mirroring
`parseComplexityTier` (validates `owner/repo#<digits>`). Unit tests for valid/absent/garbled.

### T6 — Daemon discovers the issue origin  (FR-3, FR-5)
`daemon.ts`: `BacklogItem.sourceRef?: string`.
`daemon-backlog.ts`: in `discoverBacklog`, read `.docs/intake/<slug>.md` from the base-branch
tree (same pattern as the complexity read) → `parseIntakeSourceRef` → set `item.sourceRef`.
Tests (injected `treeSource`): item carries sourceRef when marker present; undefined + still
buildable when absent/garbled.

### T7 — Implementation PR gets `Closes`  (FR-4, FR-6, FR-7)
`daemon-cli.ts` `runConductorInWorktree`: after `await conductor.run()`, read the impl PR URL
from `conduct-state.json` (`pr_url`); if `item.sourceRef` and a URL exist, call
`injectIssueRef({ keyword: 'Closes', prUrl, sourceRef: item.sourceRef, cwd: wt.path, gh, log })`.
Non-fatal. Tests: Closes injected when both present; skipped when sourceRef or url absent;
idempotent; gh failure does not throw.

### T8 — Docs + release gates
- `src/conductor/README.md` (intake section) + `README.md`: document the `.docs/intake/<slug>.md`
  carrier, spec-PR `Refs`, impl-PR `Closes`, and the close-on-implementation-merge behavior.
- `CHANGELOG.md` `## [Unreleased]` → **Added**.
- VERSION: MINOR bump (additive intake behavior) — present to operator for approval before PR.

## Verification (end-to-end)
- `cd src/conductor && npm run build` (tsc clean) and `npm test` green (all new unit tests).
- `bash test/test_harness_integrity.sh` passes.
- Manual trace (script-level): construct an envelope with a sourceRef through landSpec →
  assert `.docs/intake/<slug>.md`; run discoverBacklog with a fake tree → assert
  `BacklogItem.sourceRef`; run injectIssueRef against a fake gh → assert idempotent body edit.
- Real-world confirmation deferred to the next live intake run (cannot merge a PR in test).
