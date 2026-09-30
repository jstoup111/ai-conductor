# Architecture Review: Surface evidence-path overlap as suggested dependencies at intake filing time

**Date:** 2026-09-28
**Mode:** Pre-stories, lightweight (Tier M)
**Issue:** #1606
**Inputs reviewed:** PRD `.docs/specs/surface-evidence-path-overlap-as-suggested-depende.md` (FR-1…FR-17, Approved);
diagram `.docs/architecture/surface-evidence-path-overlap-as-suggested-depende.md` (Approved);
track scope boundary `.docs/track/surface-evidence-path-overlap-as-suggested-depende.md` (Balanced).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | No new packages or services. It uses the existing tracker read interface (`runTrackerRead`, `repository.read`, which already allows `gh issue list`; verified in `tracker-client.ts`, the `repository.read` arg allowlist), the existing git runner, and the registry reader (`createRegistryReader` / `readRegistry` in `engine/registry.ts`, whose records carry `path` and a redacted `remote`). *(verified)* |
| **Prerequisites** | None to build. #2714 must be fixed for accepted links to actually record on GitHub. This feature attempts the links the same way as today, so a failed link stays on the existing warning path. *(verified: #2714 open; failure is `gh api -f issue_id` sent as a string)* |
| **Integration surface** | Three seams: the filing path (`intake-file-cli.ts` → `fileIntakeIssue`), the overlap primitives (`engine/overlap-scan.ts`, `engine/rebase.ts`), and the event union (`types/events.ts`). The registry is only read. No external API beyond GitHub reads already in use. |
| **Data implications** | No schema or migration. One additive `ConductorEvent` variant. |
| **Performance risk** | Unbounded open-issue lists and branch diffs are the only risk. Mitigated by the bounds in D5 below, each reported as a partial check when hit (FR-14). |
| **Worktree isolation** | No ports, databases or shared services. The check reads branch refs, which are shared across worktrees by design. |

## Alignment

### Governing ADRs (reused, no new ADR)

- **`adr-2026-07-21-intake-only-enforcement` (APPROVED).** This ADR puts completeness enforcement at
  capture/file time and forbids any *downstream* failure mode. Its Consequences already make
  linking "an explicit at-intake decision". This feature strengthens that exact decision at the exact
  point the ADR selects, and adds nothing downstream: `claimUnblocked`, `poll()`, daemon dispatch and
  CI stay unchanged. The ADR's "default, never an error" rule governs absent size/priority fields
  and stays untouched. The companion architecture doc's fail-soft invariant ("on any error … never
  blocks filing") is preserved by FR-14: errors *inside* the check never block. The non-TTY
  refusal (FR-10) is not an error path. It is the filer being asked for the at-intake linking
  decision the ADR requires, and it happens before anything is published. **Assumption A1 (below)
  records this reading for operator confirmation.**
- **`adr-2026-07-21-decide-time-unmerged-overlap-scan` (APPROVED).** D1 (a deterministic primitive,
  not prompt discipline) is followed. D3 ("advisory, never blocking") governs the **DECIDE-time**
  scan and stays true. This feature reuses the primitive's building blocks at a different seam and
  must not change the DECIDE-time scan's behavior or branch set (condition C2).
- **`adr-2026-07-22-canonical-tracker-client-seam` / `adr-2026-09-11-github-operation-ownership`
  (APPROVED).** All new GitHub access is reads through `runTrackerRead`. The creation transaction
  (`executeGithubIssueCreationTransaction`) and its registered operations (`issue.create`,
  `issue.label.add`, `issue.dependency.add`) are unchanged. Accepted suggestions enter as ordinary
  dependencies, so no new write operation or authority is introduced.
- **Event spine (CLAUDE.md, `.agents/skills/event-spine`).** The check outcome is an occurrence in
  time, so it becomes one new `ConductorEvent` variant, emitted on the emitter that `intake-file-cli`
  already starts with its `EventPersister`. No sidecar file and no bespoke log.

### Open Questions resolved (design decisions for BUILD)

- **D1: Recognizing a cited path.** A token counts as a cited path when it is path-shaped: it contains
  a `/` or has a file extension, after stripping surrounding backticks and quotes, a leading `./`,
  and a trailing `:line` or `:line-line` / `#Lnn` suffix. When the target checkout is available,
  candidates are then filtered to paths that exist at the base ref's tree **or** appear in a scanned
  branch diff. That filter removes URL fragments, prose like "and/or", and paths from other repos.
  With no checkout, the unfiltered candidates are used (exact matching still applies).
  Matching reuses `intersectFiles` (exact equality after normalization). Rejected: accepting any
  slash-bearing token unfiltered (false suggestions from URLs and prose), and fenced-citation-only
  recognition (misses inline evidence, which is what the four motivating cases cite).
- **D2: Reuse, not a new scanner.** Reuse `intersectFiles`, `resolveBase`,
  `changedPathsSinceMergeBase` and `enumerateUnmergedBranches`. The enumerator gains an optional
  ref-pattern parameter so the filing check can add `refs/heads/feat/daemon-*` and
  `refs/remotes/*/feat/daemon-*`. **Its default stays exactly `spec/*`**, so the DECIDE-time
  scan is unchanged (C2). `runOverlapScan` and `renderReport` are not reused because their report
  shape is advisory-DECIDE-specific. The filing preflight is a new module that composes the shared
  primitives. Rejected: a second scanner, since it would duplicate the diff and intersection logic
  (the ADR D1 reuse precedent).
  > **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** Under squash-merge, a shipped `feat/daemon-«slug»` branch keeps commits ahead of base forever (`adr-2026-08-01-multi-proof-park-deletion-authority`), so ahead-count alone does not prove a branch is in flight. The filing preflight (only) also excludes a branch whose `.docs/shipped/«slug».md` exists on the base ref, the same shipped-record dedup `daemon-backlog` uses. Excluded branches do not count toward the D5 branch bound. The DECIDE-time default stays unchanged (C2).

- **D3: Locating the target checkout (FR-15).** `bin/intake-file` `cd`s into the engine directory,
  so the invoking directory has to be captured *before* that `cd` and handed to the CLI. Resolution
  order:
  1. The invoking directory, if it is a git checkout whose `origin` resolves to the target
     `owner/repo`.
  2. Otherwise, the single registry record whose `remote` resolves to the target `owner/repo`.
  3. Otherwise (no match, or more than one ambiguous registry match), skip the in-flight comparison
     with a skip note.

  The harness's own engine directory is never used unless it genuinely is the target checkout
  under rule 1 or 2. Rejected: always using the harness directory, which is today's cwd and would
  diff the wrong repo for every consumer. Also rejected: requiring an explicit path input, which
  adds burden in the common case (FR-8).
  > **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** #742 (`adr-2026-09-28-skills-may-bundle-executable-helpers`) removes `bin/intake-file` and runs the CLI from the caller's directory without a `cd`. #1606 is now blocked_by #742 and lands after it, so the "invoking directory" in step 1 is the CLI process's working directory. No wrapper hand-off is added, and the #742 helper's argv pass-through is untouched. The registry read honors `AI_CONDUCTOR_REGISTRY` (`adr-2026-07-22-examples-state-isolation`).

- **D4: Tracing a branch to its issue (FR-4).** The branch's slug is its ref suffix after `spec/` or
  `feat/daemon-`. The originating issue is the `Source-Ref:` line of `.docs/intake/<slug>.md` read
  from **that branch's tree**, with the same grammar `daemon-backlog.ts` already parses. Parse the
  ref with the shared `parseSourceRef` (`engine/issue-ref.ts`). A missing, unreadable or unparseable
  marker makes that overlap advisory-only (FR-4). A traced issue that is closed or belongs to a
  different repository than the filing target is also advisory-only.
  > **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** Read the marker through the existing marker read-back owned by `artifacts.ts` (`parseIntakeSourceRef` / `parseWorkRef`, per `adr-2026-07-22-canonical-tagged-source-ref`), then narrow to GitHub with `parseSourceRef`. Do not add a third `Source-Ref:` parser.

- **D5: Bounds (NFR bounded cost).** These are fixed engine constants, not new configuration keys:
  - at most 500 open issues read, in one list call;
  - at most 100 unmerged branches compared, most recently committed first;
  - at most 5 linkable suggestions shown, with the omitted count reported (FR-6).

  Hitting a bound produces a skip note. Each git or tracker call inherits the runner's existing
  timeout behavior; a timeout is a skip note (FR-14).
- **D6: Where the decision gate lives.** The preflight runs **inside `fileIntakeIssue`**, before the
  creation transaction, as an injected dependency the production CLI always supplies. That makes it
  the same single choke point as the sanitizer. With the dependency omitted, behavior is today's.
  The TTY prompt uses the CLI's existing `readline` prompt dependency. A refusal returns a result
  with no `issueUrl`, and the CLI maps it to a non-zero exit plus the suggestion listing (FR-10).
  Declines arrive as a new repeatable CLI input. A decline naming an issue that is not a current
  linkable suggestion is rejected before creation (FR-13).

  > **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** Engine-internal non-interactive filers of `fileIntakeIssue` never receive the preflight and are never refused. These are the build_review deferral executor and the beyond-filing reconciliation, both in `engine/conductor.ts`. A refusal there would be a downstream failure, which `adr-2026-07-21-intake-only-enforcement` forbids, and `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D5 says "Filing never blocks a lap". A test pins that these callers get no preflight.

### Pattern consistency

The work follows the filer's existing contract: labels and links are warnings after creation, and
only a failed create (or now a pre-create refusal) is fatal. The new CLI input is additive. It is not
`bin/conduct` CLI, `settings.json`, hook wiring or a skill symlink target, so no migration block is
required.

## Wiring Surface

| New / changed surface | Production caller (design-time) |
|---|---|
| Filing overlap preflight module (new, under `engine/engineer/intake/`) | Invoked by `fileIntakeIssue` before `executeGithubIssueCreationTransaction`; wired in production by `intake-file-cli.ts` `main()` via the deps object |
| Cited-path extractor (new, same module) | Called by the preflight for the new intake's title and body and for each open issue's body |
| Target-checkout resolver (new) | Called by `intake-file-cli.ts` `main()` using the invoking directory passed from `bin/intake-file` and `createRegistryReader()` |
| `bin/intake-file` invoking-directory hand-off (changed) | The operator- and agent-facing entry point; passes the pre-`cd` directory to the CLI |
| `enumerateUnmergedBranches` ref-pattern parameter (changed, default unchanged) | Called by the preflight with the spec and daemon patterns; the existing `runOverlapScan` caller keeps its default |
| Decline input on the filer CLI (new) | Parsed by `intake-file-cli.ts` `parseArgs` and passed into `fileIntakeIssue` options |
| Overlap-check `ConductorEvent` variant (new) | Emitted by the preflight on the `ConductorEventEmitter` that `intake-file-cli.ts` already constructs and persists |
| `/intake` skill §9 and `docs/guides/intake.md` (changed) | Read by filers; FR-17 guidance on acting on a refusal |

> **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** Two changes to the table above. First, the "`bin/intake-file` invoking-directory hand-off" row is withdrawn (see the D3 amendment). Second, the new event variant declares an `EVENT_SINKS` row (`adr-2026-07-26-event-sink-registry-exhaustiveness`; `persist: true`, `audit: false`, following the `intake_inbound_sanitized` precedent) and persists to the filer's existing event record. Open-issue bodies are read outside the inbound adapter. Only their exact intersection with the filer's own cited paths is ever printed or emitted, never raw tracker text (`adr-2026-09-06-inbound-intake-trust-boundary` D1).

**Early overlap scan** (`ai-conductor overlap-scan` over the paths above, 2026-09-28): `No overlap
detected; no open blockers.` This is advisory and only covers `spec/*`. Known in-flight neighbours
that the scan cannot see yet are recorded as risks below.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Accepted suggestions don't record on GitHub until #2714 ships | Integration | High (until fixed) | Medium | Link #1606 as blocked_by #2714. The existing warning path names each failed link. |
| #742 (bundled skill helpers, spec PR #2787) relocates `bin/intake-file` into the skill bundle | Integration | Medium | Medium | `/conflict-check` will surface it. The invoking-directory hand-off must survive the relocation, so land order is decided at conflict-check or the plan. |
| False suggestions from generic paths (e.g. `package.json`, `README.md`) cause refusal fatigue for agents | Technical | Medium | Medium | The D1 existence filter plus ranking by shared-path count. Tests cover a generic-path-only intake. A tuning follow-up is possible, but no stop-list is invented now. |
| A registry holds two records for the same remote | Technical | Low | Low | D3 treats that as ambiguous and skips with a note. It never guesses. |
| Reading 500 issue bodies slows every filing | Performance | Low | Low | One list call. The D5 cap. |

## ADRs Created

None. Every structural question is governed by an existing APPROVED ADR (cited above). The
decisions D1–D6 are feature-level design choices within those ADRs, not new system boundaries,
integration patterns, state architecture or foundational technology.

## Assumptions (verify-claims)

- **A1: The non-TTY refusal (FR-10) is compatible with `adr-2026-07-21-intake-only-enforcement`**,
  because that ADR forbids downstream failure modes and defaults for missing *fields*, while
  requiring linking as an explicit at-intake decision. Confidence 80% (inferred from the ADR
  text). Impact if wrong: the ADR would need an operator-approved amendment before BUILD.
  **Operator-confirmed 2026-09-28** (C5 satisfied).
- **A2:** `gh issue list` through `repository.read` returns bodies for open issues in one call
  within the cap. Confidence 90% (verified allowlist; body field support inferred from `gh`).
- **A3:** Daemon build branches are `feat/daemon-<slug>`. Confidence 95% (verified
  `DAEMON_BRANCH_PREFIX` in `halt-pr-reconciliation.ts` and `finish-record-cli.ts`).

## Conditions

- **C1:** #1606 is blocked_by #2714 for the "accepted link is recorded" outcome. This feature does
  not fix #2714.
- **C2:** The DECIDE-time `overlap-scan` output and branch set stay byte-for-byte unchanged. A
  regression test pins `enumerateUnmergedBranches`' default pattern.
- **C3:** Errors inside the check never produce a refusal (FR-14). Only undecided linkable
  suggestions do.
- **C4:** The ordering relative to #742's `bin/intake-file` relocation is resolved at
  `/conflict-check`.
  > **Amended 2026-09-28 by #1606 (conflict-check, operator-approved):** Resolved: #742 lands first (blocked_by link recorded 2026-09-28).

- **C5:** A1 is confirmed by the operator before stories are accepted. Satisfied 2026-09-28.
