# Track: Build progress display should be 1-based

**Track: TECHNICAL**

## Problem statement

The daemon's build-step progress display reports the task/step position starting
from 0. When the first task of an N-task build is in progress, the operator sees
`▶ build 0/N` in `.daemon/daemon.log` (and the equivalent `progress 0/N` line in
the interactive create renderer). To a human watching a build, `0/N` reads as
off-by-one: the first task is being worked, yet the counter says zero.

## Desired outcomes

1. Build progress display shows a **1-based** index — the first in-progress task
   is `1/N`, the last is `N/N`, never `0/N` as an in-progress state.
2. The total `N` is unchanged and correct.
3. No off-by-one at the boundary — a completed count of `N` still reads `N/N`,
   never `N+1/N`.
4. Purely a **display / labelling** change — the underlying completion
   accounting, gate logic, and task-status semantics are untouched.

## Why technical (no product surface)

No user-facing product requirement, no data model, no API. This is a
presentation-layer relabelling of an existing telemetry line. There are no
functional requirements to enumerate in a PRD; the acceptance signals are fully
expressible as Given/When/Then stories over the render seams. → `/prd` skipped.

## Discovery: where the 0-based value is emitted vs displayed

The build-progress counter originates in `BuildProgressWatcher`
(`src/conductor/src/engine/build-progress-watcher.ts`). Each tick computes:

```
const resolved = tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
const total    = tasks.length;
const current  = tasks.find(t => t.status === 'in_progress');
```

and emits a `build_progress` event (and, during a quiet episode, a
`build_no_progress` event) carrying **`resolved`**, **`total`**, and the current
task's id/name (`currentTaskId` / `currentTaskName`). The event type is defined
in `src/conductor/src/types/events.ts` (lines ~99-130).

`resolved` is a **cardinal count of completed/skipped tasks** — it is 0 while the
first task is still in progress. That raw count is the accounting value: it is
consumed downstream by stall detection (`build_stall`, `resolvedBefore`/
`resolvedAfter`), the `build_progress_halt` eligibility check in `daemon-cli.ts`,
and the quiet-episode state machine. **It must not change.**

The `0` an operator sees is produced purely at the **render seams**, which
string-format the raw event payload:

- `src/conductor/src/daemon-cli.ts` — `renderDaemonEvent` →
  - `build_progress` (line ~1722): `` `${chalk.cyan('▶')} ${event.step} ${event.resolved}/${event.total}${task}${slug}` ``
  - `build_no_progress` (line ~1730): `` `${event.step} quiet ${event.quietMinutes}m (${event.resolved}/${event.total})` ``
- `src/conductor/src/ui/create-renderer.ts` — interactive renderer →
  - `build_progress` (line ~216): `` `⠿ ${event.step} — progress ${event.resolved}/${event.total}${task}` ``
  - `build_no_progress` (line ~225): `` `⚠ ${event.step} — no progress for ${event.quietMinutes}m (${event.resolved}/${event.total})` ``

**Conclusion: the `0` is a display base, NOT load-bearing accounting.** The fix is
a pure display transform applied at these four render sites (backed by one shared
helper). The event payload, watcher computation, gate/stall logic, and
task-status semantics are all left byte-for-byte unchanged. This satisfies
desired outcome (4) by construction.

### The 1-based transform (and its boundary safety)

Both render kinds carry the current-task identity, so "is a task in progress" is
derivable at the seam without new plumbing:

```
hasCurrent = Boolean(event.currentTaskId || event.currentTaskName)   // build_progress
hasCurrent = Boolean(event.currentTaskId)                            // build_no_progress
displayIndex = Math.min(resolved + (hasCurrent ? 1 : 0), total)
```

- First task in progress: `resolved=0`, `hasCurrent=true` → `1/N` (outcome 1). ✓
- Last task in progress: `resolved=N-1`, `hasCurrent=true` → `N/N`. ✓
- All tasks done: `resolved=N`, `hasCurrent=false` → `N/N`, never `N+1/N`
  (outcome 3). ✓ The `Math.min(..., total)` clamp is a defensive guard so the
  numerator can never exceed the total even in a would-be `resolved=N &&
  hasCurrent` transient.
- Transient between tasks (no current, `resolved=k`): shows `k/N` (the completed
  count) — always `≤ N`, monotonic, non-confusing.
- `total` is passed through untouched (outcome 2). ✓

The watcher already suppresses the empty `0/0` "no data" snapshot (it does not
emit on an unparseable/empty task-status), so `total=0` is not a live concern; the
clamp still renders it harmlessly as `0/0`.

## Scoping note: `formatProgressDelta` ("0→1 tasks") is intentionally OUT of scope

`src/conductor/src/engine/format-retry-line.ts#formatProgressDelta` renders the
`resolvedBefore → resolvedAfter tasks` fragment on retry lines (e.g. `0→1 tasks`).
This is a **cardinal delta of completed-task counts**, not an ordinal position:
`0→1 tasks` correctly means "completed count went from 0 to 1". 1-basing a count
delta would make it *wrong* (0 completed is genuinely zero completed). The
operator-facing off-by-one the idea targets is the **position indicator**
`resolved/total`, addressed by outcomes (1) and (3). This fix deliberately does
NOT touch `formatProgressDelta`; the plan calls this out so a builder does not
naively `+1` a count.

## Related work

Relates to the build-progress counter work (#757). This spec does not depend on
any unmerged branch — it edits render seams that exist on `main` today.
