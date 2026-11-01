# ADR: The engine performs FINISH's PR-prose write; the provider only returns prose

**Date:** 2026-10-31
**Status:** APPROVED
**Deciders:** Operator (scope, approach, decisions, and assumption verification confirmed during DECIDE for jstoup111/ai-conductor#3529)

## Context

FINISH's `author_pr_prose` transition dispatches a provider pass to write the retained pull
request's title and body. The coordinator then re-observes the PR and treats unchanged placeholder
prose after a completed pass as a fixed point (`human_required` / `publication_transition_unmoved`,
adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns).

How the provider performs that write was never fixed by a contract it could follow:

- The FINISH author prompt in `step-runners.ts` and `skills/finish/SKILL.md` ("PR Prose
  Authoring") tell the provider to "rewrite the retained PR's title and body in place".
  `skills/pr/SKILL.md` tells it the opposite: return the title and body to the publication
  engine, which owns the guarded write, and use no direct command.
- No skill documents the `pull-request.edit` request shape that
  `ai-conductor github-operation --request-file` accepts. `decodeGithubOperationRequest` reads
  `resource` plus a top-level `repository`.
- The FINISH judge prompt also lets the provider "repair only that title/body, at most once".

Each provider improvisation has failed differently. In #2709 the session guard blocked
`github-operation`. In #3376 `gh pr edit` lacked token scope; adr-2026-10-24 made that failure
visible. In #3529 Case A (PR #3523), a refused bare `ai-conductor --help` (`blocked subcommand:
<none>`) made Codex conclude that `github-operation` was blocked too, and it quit without authoring.
In #3529 Case B (PR #3524), Codex authored good prose and then sent a request with a `target` key,
which was refused as `invalid-target`. Every one of these halted needs-human. The engine already
holds every piece needed to do the write itself: `executeGithubOperation` with the
`resolveShipDraftPublicationDependencies` guarded operations (used today by
`restoreCapturedRegionsFrom`), `restoreRegion`/`extractRegionBytes` in `pr-body-regions.ts`, and
the observer's own prose classification.

## Options Considered

### Option A: The engine owns the write; the provider returns prose
- **Pros:** No provider ever builds a GitHub request, so the #2709/#3376/#3529 family cannot
  recur. Validation and region preservation become code. Matches the repository's
  machinery-by-default principle.
- **Cons:** The provider gets no in-session feedback from the write. A malformed return costs one
  bounded retry pass.

### Option B: Document the provider-side request shape and accept the `target` alias
- **Pros:** Smallest diff.
- **Cons:** Prompt discipline stays load-bearing. It fixes only Case B; the next improvisation fails
  differently.

### Option C: A sanctioned `ai-conductor pr-prose submit` subcommand
- **Pros:** Gives in-session validation feedback, and no JSON shape to build.
- **Cons:** It still depends on the provider choosing to call it. It also adds a CLI surface that the
  migration and release gates must cover.

## Decision

Option A.

1. **The provider returns prose through a versioned handoff file.** The FINISH author pass, both the
   initial pass and the revision pass that carries revision guidance, writes
   `.pipeline/finish-pr-prose.json` in the feature worktree as
   `{"version":1,"title":"…","body":"…"}`, and makes no PR edit. Before dispatching a pass, the
   production `authorProse` effect deletes any existing handoff, so a file can only come from that
   pass. After the dispatch returns, the effect reads it once and decodes it. A missing file,
   unparsable JSON, an unknown version, or a non-string or empty `title` or `body` is a typed
   authoring failure. The final-output channel is rejected: a markdown body inside JSON that the
   engine extracts with a regex from free text is fragile. The file follows the
   `.pipeline/documentation-delivery.json` precedent of a provider-produced payload read by the
   engine. It is durable data, not an occurrence, so it is not a parallel event channel.
2. **The engine applies the prose and performs the guarded write.** The effect reads the PR's
   current body. It re-splices every `ai-conductor:step` region from that body into the returned
   body with `restoreRegion`, so the provider cannot alter, drop, or duplicate a step region. It
   then validates the result:
   - the title is non-empty after trimming;
   - the observer's own prose classification no longer reads the body as placeholder;
   - when the current body carries a `Closes <ref>` reference, the result still carries that
     reference.

   A body that fails validation is a typed authoring failure that names the failed check. A valid
   result is published with `executeGithubOperation` `pull-request.edit` (payload `title` and
   `body`). That uses the guarded operations `resolveShipDraftPublicationDependencies` resolves,
   the same path `restoreCapturedRegionsFrom` uses. A non-executed result raises the existing
   typed publication-operation failure. Re-observation stays the only authority on whether
   `pr.prose` moved, so adr-2026-08-13's fixed-point guard is unchanged.
3. **The judge pass never writes.** The FINISH judge prompts, unattended and interactive, drop
   the permission to repair the title or body. The judge returns only its verdict JSON. A
   `revision_required` verdict reaches the author revision pass through the existing
   observation-derived `revision_required` routing (the 2026-08-28 amendment to
   adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns), so
   every prose change goes through decision 2.
4. **Authoring failures are reported by their cause.** The coordinator's `author_pr_prose` branch
   maps a typed authoring failure to `publication_retry` with reason `prose_not_returned` (no
   handoff) or `prose_invalid` (decode or validation failure). The failure detail names the failed
   check, and it is carried to the next author pass as revision guidance. Both reasons are ordinary
   `retry_finish` routes. They spend the FINISH step's existing attempt budget, the same budget
   every `publication_retry` spends; neither reason joins the non-retryable set. When that budget
   is exhausted, the existing `FINISH publication retry exhausted: <reason>` halt names the reason,
   now followed by the retry's detail, and it is never `publication_transition_unmoved`. A failed engine edit still returns `human_required` /
   `publication_operation_failed` (adr-2026-10-24 D4), and a failed dispatch still follows the
   existing `authoring_dispatch_failed` retry.
5. **The provider-write failure observation is retired.** The engine now performs the
   `pull-request.edit` itself and receives its result directly. The `authorProse` effect therefore
   no longer flushes the session event tail or subscribes to `github_operation_failed` around the
   dispatch, and that machinery is deleted. This supersedes adr-2026-10-24 D3 and narrows its D5.
   The CLI's `github_operation_failed` emission (adr-2026-10-24 D1–D2) is unchanged, because other
   guarded operations still use it.
6. **One written contract.** `skills/finish/SKILL.md` and `skills/pr/SKILL.md` both state that in
   FINISH the provider writes title and body to the handoff file and the engine performs every PR
   title and body write. The FINISH author, revision, and judge prompt blocks in `step-runners.ts`
   state the same. The `github-operation` comment in `daemon-session.ts` that names the
   author_pr_prose pass as its caller is corrected. `github-operation` itself stays sanctioned.
7. **A missing-subcommand refusal does not read as a blocked command.** When
   `evaluateDaemonSessionCommandPolicy` refuses an `ai-conductor` invocation with no subcommand,
   including a bare `--help`, the refusal states that no subcommand was given. It also lists the
   sanctioned subcommands, so an agent cannot read it as refusing those subcommands. The policy
   decision itself (refuse) is unchanged.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The FINISH provider pass and the publication coordinator share the feature worktree's `.pipeline/`: the daemon gives `DefaultStepRunner` `wt.path` as its directory and `createProductionFinishPublicationCoordinator` `projectRoot: wt.path` with `stateFilePath` under `wt.path/.pipeline` (`daemon-cli.ts` dispatch wiring) | verified | 95% | yes | The engine never finds the handoff and every pass reads as `prose_not_returned` | n/a |
| A2 | Interactive FINISH uses the same author pass: the author prompt block in `step-runners.ts` and the conductor's `dispatchAuthoring` wiring are independent of mode | verified | 90% | yes | Interactive FINISH would keep the provider-side write | n/a |
| A3 | `pull-request.edit` accepts `title` and `body` together (`payloadFrom` `pull-request-edit` in `github-operations.ts`) | verified | 95% | yes | The title would need a second operation | n/a |

## Consequences

### Positive
- A provider can no longer stall FINISH by improvising a GitHub write: there is none to improvise.
- `ai-conductor:step` regions are preserved by code rather than by instruction.
- A halt in this transition names its real cause.

### Negative
- A provider that returns malformed prose learns it only on the next bounded pass, through revision
  guidance.
- One more engine-read payload file under `.pipeline/`.

### Follow-up Actions
- [ ] Implement decisions 1–7 under the plan for `finish-author-pr-prose-halts-unmoved-provider-has-`.
- [ ] #1774 (authored prose drops the release metadata block) stays a separate intake. Decision 2
      preserves step regions but makes no change to release-metadata authoring.
