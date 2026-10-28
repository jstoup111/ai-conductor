---
title: Stacked feature manual recovery
parent: Runbooks
nav_order: 9
---

# Stacked feature manual recovery

Recover a stacked feature (sliced children `feat/c<k>/<slug>` under a leaf `feat/daemon-<slug>`,
with routed whole-feature repairs) when the engine halts or stops and the halt text does not say
how to proceed. Each section gives the verbatim symptom, read-only diagnosis, the exact recovery,
and how to verify it. For generic restack reasons, start with
[A stacked restack halted](stalled-or-stuck-feature.md#a-stacked-restack-halted).

Commands below run from the main repository root unless they `cd` into
`.worktrees/<slug>`. Replace `<slug>` with the feature slug and `<k>` with a child id.

> **Agent operators.** `ai-conductor kickback-budget raise|reset`, `ai-conductor halt clear`, and
> `ai-conductor build-review accept|resolve-case` refuse without an interactive terminal. An agent
> acting on an explicit operator decision runs them under a pty:
> `script -qec '<command>' /dev/null`.

## Safety rules

- **Park before touching a feature's branches or worktree**
  (`ai-conductor daemon park <slug>`). Clearing a HALT or writing routing refs while a feature
  is halted needs no park, because the HALT already holds it. Never unpark-then-delete. These are
  the Daemon Operations Safety rules in the repository's `CLAUDE.md`.
- **Never hand-edit durable routing or remediation state.** That means `refs/conductor/<slug>/*`
  blobs (route records, `repairing`, `revalidate`, `cascades`, `restack/*`) and
  `.pipeline/remediation-cases.json` or `.pipeline/children/<k>/remediation-cases.json`. Change
  them only through the CLI or the engine's own transaction functions (section 3).
- **Confirm the feature is not in flight** before any write:
  `ai-conductor daemon status | grep "IN FLIGHT \[<slug>"` must print nothing.
- **Scope every destructive command** to one named path or ref. No globs, no loops.

## 1. Inspect stack and routing state

All of this is read-only.

```bash
cd .worktrees/<slug>
git for-each-ref --format='%(refname) %(objectname:short) %(objecttype)' refs/conductor/<slug>/
```

| Ref | Meaning |
| --- | --- |
| `closed/c<k>` (commit) | Closure tip of child k: its approved end state. |
| `routes/r<N>` (blob) | Route record of routed-repair round N. |
| `repairing` (blob) | Repair marker `{"host":<k>,"roundId":"r<N>"}`: the one host currently repairing. |
| `revalidate` (blob) | Revalidation queue. |
| `cascades` (blob) | Restack cascade counts and limits per originating child. |
| `positions` (blob) | Child order in the stack. |
| `leaf-moved` (commit) | Last leaf tip a restack moved. |
| `restack/journal`, `restack/staging/c<k>` | An in-progress or interrupted restack. |
| `pushed/<branch>`, `push-intent/<branch>` | Last pushed tip per branch. |
| `red/c<k>` | Recorded failing-acceptance baseline for child k. |

Summarize every round:

```bash
for r in $(git for-each-ref --format='%(refname:lstrip=-1)' refs/conductor/<slug>/routes/); do
  git cat-file -p refs/conductor/<slug>/routes/$r |
    python3 -c "import json,sys;d=json.load(sys.stdin);print('$r',d['kind'],d['phase'],d['hosts'],d.get('currentHostIndex'))"
done
git cat-file -p refs/conductor/<slug>/repairing; echo
git cat-file -p refs/conductor/<slug>/cascades; echo
```

A healthy feature has at most one round with `phase` `open`. Each host moves through
`pending → admitted → repairing → built → restacked`, ending in `restacked`, `done` or
`rerouted`. A `closed` round never has a pending, active, or built host.

To see which child the engine thinks is active, run the cursor probe from the
[throwaway-clone procedure](#4-silent-stops-loop-ended-without-done-or-halt-marker) against the
real worktree path. It only reads:

```ts
import { resolveActiveChild } from '<repo>/src/conductor/src/engine/child-cursor.ts';
void (async () => console.log(JSON.stringify(await resolveActiveChild('<repo>/.worktrees/<slug>', '<slug>'), null, 1)))();
```

A routed repair in progress reads `{"kind":"repair-pending", ..., "routedRepair":{"child":<host>,"roundId":"r<N>"}}`.

Budgets per child:

```bash
ai-conductor kickback-budget inspect --feature <slug> --child <k>
```

`inspect` accepts `--feature`, optional `--child` and `--format`. It refuses `--gate`.

## 2. Restack cascade cap

**Symptom** (`.pipeline/HALT`, class `needs-human`):

```text
restack refused (cascade-cap) child 1
originating child 1 reached 3/3 cascades
Runbook: Routed repair halted on the cascade cap
Child: 2
Kickback budget (restack): 3/3 consumed; 0 remaining
...
Kickback halt generation: <generation>
```

**Diagnosis.** Two child ids appear. `restack refused (cascade-cap) child <origin>` names the
**originating** child whose cascades ran out. `Child: <active>` names the **active** child, which
is where the ledger evidence is recorded. Inspect the active child to see the exhausted budget:

```bash
ai-conductor kickback-budget inspect --feature <slug> --child <active>   # shows restack 3/3
ai-conductor kickback-budget inspect --feature <slug> --child <origin>   # may show 0/3
```

**Recovery.**

1. Make sure `.pipeline/HALT` is still the cascade-cap text above. The resume authorization
   matches the `Kickback halt generation` line. On engines before
   [#3444](https://github.com/jstoup111/ai-conductor/pull/3444), a generic
   `child BUILD region refused: routed exit host N: halted` replaced it. If so, restore the
   original text from the first halt-record commit of that episode:

   ```bash
   cd .worktrees/<slug>
   git log --format='%h %ci %s' -5 -- .docs/halted/<slug>.md
   git show <first-commit>:.docs/halted/<slug>.md | awk '/^```text$/{f=1;next} /^```$/{f=0} f' > .pipeline/HALT
   ```

2. Raise the cap, naming the **originating** child:

   ```bash
   ai-conductor kickback-budget raise --feature <slug> --gate restack --child <origin> --by 2 \
     --rationale "<why more cascades are justified>"
   ```

   The output ends `Resume authorization: pending (live halt not read)`.

3. The daemon consumes the authorization and resumes. If the resume then ends with
   `loop ended without DONE or HALT marker` and `Resume authorization: consumed`, the HALT file
   survived the resume and stack preflight refused on it without saying so. Engines with the
   [#3446](https://github.com/jstoup111/ai-conductor/issues/3446) fix instead report the feature
   `halted` with `live HALT without resume authorization: <first HALT line>`. Either way, clear it:

   ```bash
   rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class
   ```

**Verification.** `git cat-file -p refs/conductor/<slug>/cascades` shows the raised limit. The next
dispatch records `restack_planned` in `.pipeline/events.jsonl`.

## 3. Two routed rounds open at once

Engine defect [#3445](https://github.com/jstoup111/ai-conductor/issues/3445).

**Symptom.** Every resume ends within seconds with no reason anywhere:

```text
■ done <slug>: error — loop ended without DONE or HALT marker
```

The daemon then writes `feature errored — will re-dispatch on the next scan` as the HALT.

**Diagnosis.** Summarize the rounds ([section 1](#1-inspect-stack-and-routing-state)). The fault
looks like this:

```text
r3 audit open {'1': 'restacked', '2': 'pending'} 0
r4 audit open {'1': 'built', '2': 'pending'} 0
```

Rounds are reconciled in ref order. The older open round tries to admit its next host and create
a repair marker, but the newer round already owns `repairing`, so the compare-and-swap fails.
Confirm with the [throwaway-clone preflight](#4-silent-stops-loop-ended-without-done-or-halt-marker):

```text
RESULT {"kind":"unavailable","detail":"round advance cas-failed"}
```

**Recovery.** Decide which round supersedes the other. Normally that is the newer one, which
came from a fresh audit. Compare items first:

```bash
for r in r3 r4; do echo "== $r"; git -C .worktrees/<slug> cat-file -p refs/conductor/<slug>/routes/$r |
  python3 -c "import json,sys;[print(' ',i['host'],i['findingId']) for i in json.load(sys.stdin)['items']]"; done
```

Closing the stale round drops its unstarted items. Record that in your halt-clear rationale.
Then close it through the engine's own compare-and-swap transaction. Never `git update-ref` a
route blob by hand: the serializer enforces round invariants that a hand-written blob skips.

Save as `close-round.mts` in a scratch directory. Edit `ROUND` and the host ids:

```ts
import { readRouteRecord, writeRoutingTransaction } from '<repo>/src/conductor/src/engine/routing/route-record-store.ts';
const wt = '<repo>/.worktrees/<slug>';
const slug = '<slug>';
const ROUND = 'r3';
void (async () => {
  const stored = await readRouteRecord(wt, slug, ROUND as never);
  if (stored.kind !== 'record') throw new Error(`${ROUND} ${stored.kind}`);
  if (stored.record.phase !== 'open') throw new Error(`${ROUND} phase ${stored.record.phase}`);
  // Every host must end restacked, done or rerouted; mark unstarted hosts done.
  const hosts = { ...stored.record.hosts, 2: 'done' as const };
  const wrote = await writeRoutingTransaction(wt, slug, [
    { kind: 'update-record', previous: stored, record: { ...stored.record, phase: 'closed' as const, hosts } },
  ]);
  console.log('WROTE', wrote.kind);
})();
```

```bash
<repo>/src/conductor/node_modules/.bin/tsx close-round.mts
```

`WROTE updated` means it succeeded. `WROTE unavailable` means the record failed validation: a
closed round needs every host `restacked`, `done` or `rerouted`, and the current host `restacked`
or `done`. Fix `hosts` and rerun. `restack-journal-open` means a restack is in progress, so let it
finish first.

Then clear the halt with an [audited clear](stalled-or-stuck-feature.md#audited-clear) that names
the closed round and its dropped items.

**Verification.** Section 1 shows exactly one open round. The next dispatch reaches the open
round's routed exit, with a `restack_planned` event or a specific restack HALT.

## 4. Silent stops: "loop ended without DONE or HALT marker"

Engine defect [#3446](https://github.com/jstoup111/ai-conductor/issues/3446): stack preflight
refusals stop the run without writing a reason. Engines with the fix never produce this symptom
from preflight. Every stopping preflight leaves `.pipeline/HALT` stating its reason, or keeps a
HALT that was already live, and emits `loop_halt` with that reason; the daemon reports the feature
`halted`. If the HALT itself cannot be written, the run errors naming both the preflight reason and
the write failure. Use this section only on older engines, or to replay preflight for the
sections that link here.

**Symptom.**

```text
■ done <slug>: error — loop ended without DONE or HALT marker
```

`.pipeline/events.jsonl` shows nothing between `project_setup` and the daemon's halt record.

**Diagnosis.** Common preflight causes are a live HALT with no matching or unconsumed resume
authorization ([section 2](#2-restack-cascade-cap), step 3), two open rounds
([section 3](#3-two-routed-rounds-open-at-once)), and a routed exit that refused. To get the exact
reason, replay preflight in a **throwaway clone**. The clone shares objects with the real
repository but has its own refs, so nothing it does can move the real feature:

```bash
S=<slug>; R=/tmp/<scratch>/replay; WT=<repo>/.worktrees/$S
rm -rf "$R"; git init -q "$R"
echo <repo>/.git/objects > "$R/.git/objects/info/alternates"
cd "$R"
git fetch -q <repo> '+refs/heads/*:refs/heads/*' "+refs/conductor/$S/*:refs/conductor/$S/*" '+refs/remotes/origin/*:refs/remotes/origin/*'
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
git config user.name "$(git -C "$WT" config user.name)"
git config user.email "$(git -C "$WT" config user.email)"
git checkout -q "$(git -C "$WT" symbolic-ref --short HEAD)"
rsync -a --exclude transcripts --exclude 'HALT*' "$WT/.pipeline/" .pipeline/
```

The identity lines matter. Without them the replay fails on
`cannot determine restack committer identity`, which is an artifact of the clone, not of the
feature.

Run preflight with an ESM `.mts` script. Top-level `await` is not supported, so wrap the call in an
async IIFE:

```ts
import { runStackPreflight } from '<repo>/src/conductor/src/engine/restack/stack-preflight.ts';
import { ConductorEventEmitter } from '<repo>/src/conductor/src/ui/events.ts';
const events = new ConductorEventEmitter();
const emit = events.emit.bind(events);
(events as any).emit = async (e: any) => { console.log('EVT', JSON.stringify(e).slice(0, 300)); return emit(e); };
void (async () => console.log('RESULT', JSON.stringify(await runStackPreflight({ worktree: '<R>', slug: '<slug>', events } as any))))();
```

```bash
<repo>/src/conductor/node_modules/.bin/tsx preflight.mts
```

To replay only a routed exit, import `requestRoutedExit` from
`src/conductor/src/engine/routing/routed-exit.ts` and call it with
`{ worktree: '<R>', slug, roundId: 'r<N>', host: <k>, skipBuiltCompareAndSwap: true, events }`.
It returns `{"kind":"halted","detail":"..."}` with the real reason. Delete the clone afterward.

**Recovery.** Follow the section that matches the reason.

## 5. Seal or generic HALTs on older engines

Both are fixed by [#3444](https://github.com/jstoup111/ai-conductor/pull/3444). Check the running
engine with `ai-conductor daemon status | grep "EXECUTOR ENGINE CURRENT"`.

- **Seal refusal on the engine's own plan append.**

  ```text
  protected-artifact seal error
  Protected artifact provenance undeterminable: .docs/plans/<slug>.md
  Missing base ref: no base branch was supplied.
  ```

  The plan drift was the engine's committed `chore(plan): append routed remediation for r<N>`, not
  tampering. Once a fixed engine is current, clear the HALT
  (`rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class`).
- **Generic routed-exit text.**

  ```text
  child BUILD region refused: routed exit host <k>: halted
  ```

  The real reason was overwritten. Read it from the first commit of the halt episode
  (`git -C .worktrees/<slug> log -- .docs/halted/<slug>.md`, then `git show <commit>:...`) and
  follow the matching section.

## 6. Restack conflicts

**"restack resolver unavailable"**, fixed by [#3447](https://github.com/jstoup111/ai-conductor/pull/3447):

```text
restack conflict child <k>
commit <sha>; paths: <paths>
restack resolver unavailable
```

Before #3447, routed exits never handed conflicts to the provider resolver. Once a fixed engine is
current, clear the HALT and the next resume tries the resolver.

**The resolver escalated.** The HALT then carries the resolver's own explanation and a
`Missing decision:` line. Settle the conflict on the named child's branch as described in
[A stacked restack halted](stalled-or-stuck-feature.md#a-stacked-restack-halted), then clear.

**Halt-record-only commits.** The engine commits `.docs/halted/<slug>.md` on the checked-out child
branch at every halt. A later restack replays those commits onto a branch carrying a newer record:

```text
replay commit <sha>; .docs/halted/<slug>.md whole record (...); ... Keeping upstream empties these
halt-record-only commits, which FR-9 featureCommitsPreserved/supersededByBase rejects as 'added
content absent'. ... Missing decision: whether halt-record-only replay commits should be replayed
verbatim (overwriting the newer upstream record) or treated as superseded
```

Tracked as [#3451](https://github.com/jstoup111/ai-conductor/issues/3451). The halt record is
engine bookkeeping, so the fix is to make the upstream child's copy match what the downstream
child's commits were made against. Then the replay applies cleanly and no commit empties.

Terms: child **K** carries the newer halt records, child **K+1** is the downstream child being
replayed, and `<oldParent>` is the K+1 base the restack replays from. That is the K closure tip
recorded before the repair, shown in the journal
(`git cat-file -p refs/conductor/<slug>/restack/journal`) or as the `oldParent` of the K+1 range.

1. Confirm the replayed history starts from `<oldParent>`'s copy of the record. The first commit
   that touches the file must have a parent copy equal to `<oldParent>`'s:

   ```bash
   git log --reverse --format=%H <oldParent>..<K+1 tip> -- .docs/halted/<slug>.md
   git diff <oldParent> <first-commit>^ -- .docs/halted/<slug>.md   # must print nothing
   ```

2. On child K's branch, in the feature worktree, set the record exactly as it stood at
   `<oldParent>` and commit it:

   ```bash
   git show <oldParent>:.docs/halted/<slug>.md > .docs/halted/<slug>.md
   git add .docs/halted/<slug>.md
   git commit -m "chore(stack): align child K halt record with child K+1's base for restack"
   ```

3. Trial-rebase in a throwaway clone that shares objects via alternates
   ([section 4](#4-silent-stops-loop-ended-without-done-or-halt-marker) shows the setup) to confirm
   that only real code conflicts remain:

   ```bash
   git checkout -q --detach <K+1 tip>
   git rebase --onto <aligned child K tip> <oldParent>
   git status --short        # expect no .docs/halted/ conflict
   git rebase --abort
   ```

4. Clear the halt with an [audited clear](stalled-or-stuck-feature.md#audited-clear) that names the
   alignment commit. The next restack replays K+1 over the aligned tip. Any remaining code
   conflicts go to the resolver.

Do not delete halt-record commits from K+1's history, and do not rewrite history by hand to get
past the preservation guard. If code conflicts remain that the resolver cannot settle, follow
[A stacked restack halted](stalled-or-stuck-feature.md#a-stacked-restack-halted).

## 7. build_review halts on a stacked child

In a stacked feature, a child's review state lives under `.pipeline/children/<k>/`:

| File | Contents |
| --- | --- |
| `.pipeline/children/<k>/build-review.json` | The child's aggregate: `lapId` and each rubric's `findings`. |
| `.pipeline/children/<k>/remediation-cases.json` | The child's remediation cases. |

`ai-conductor build-review findings` and `build-review accept` read only the root
`.pipeline/build-review.json`. On a stacked child they fail with
`current feature state is invalid or unavailable`, even when given `--child`. `accept` has no
`--child` at all. This is [#3448](https://github.com/jstoup111/ai-conductor/issues/3448).

**Symptom (semantic case repeat).** No runbook section existed for this before
[#3449](https://github.com/jstoup111/ai-conductor/issues/3449):

```text
build_review adjudication halted: semantic remediation case repeat <case-id>
```

**Diagnosis.** Read the case and its finding directly. Both reads are safe:

```bash
cd .worktrees/<slug>
python3 -c "
import json; d=json.load(open('.pipeline/children/<k>/remediation-cases.json'))
cs=d.get('cases',d); cs=cs.values() if isinstance(cs,dict) else cs
[print(json.dumps(c,indent=1)) for c in cs if c.get('id')=='<case-id>']"
python3 -c "
import json; d=json.load(open('.pipeline/children/<k>/build-review.json'))
print(d['lapId']); [print(json.dumps(f,indent=1)) for r in d['results'].values() for f in r.get('findings',[])]"
```

A repeat means the case was `act`, its action was applied (`effect.status: applied`), and the next
review raised the same concern. Decide whether the finding can actually be satisfied. One example
that cannot: a test-insensitivity finding on behavior the feature did not change, where the code
under test is a behavior-preserving refactor, so no test can fail against the base.

**Recovery.** If the finding is accepted risk or already fixed, resolve the case on the child,
then do an audited clear:

```bash
ai-conductor build-review resolve-case --feature <slug> --child <k> --case <case-id> \
  --rationale "<why this is accepted risk or fixed>"
ai-conductor halt clear --feature <slug> --rationale "<case-id> resolved: <why>"
```

If the finding is real, fix it on the child's branch and leave the case open. For flat features and
the other build_review halts, see
[open action case](stalled-or-stuck-feature.md#build_review-halted-on-an-open-action-case) and
[recurrence limit](stalled-or-stuck-feature.md#build_review-halted-on-a-recurrence-limit).

**Verification.** `resolve-case` prints `resolved <case-id>`. The next `build_review` lap settles
or routes without repeating the halt.

## 8. Shipped-record hash mismatch on a stacked PR

**Symptom.** The `shipped-record` check fails on the feature PR:

```text
shipped-record: shipped-record-hash-mismatch
```

It typically follows an amendment to the feature's plan or stories after its shipped record was
stamped, such as an operator commit pushed onto the PR.

**Diagnosis.** The daemon's CI-fix session may already have committed the refreshed `spec_hash` in
the `resolve-<slug>` worktree and then stopped pushing once its attempts were exhausted:

```bash
grep "ci_failed\[<slug>\]" .daemon/daemon.log | tail -2          # phase=exhausted
git -C .worktrees/resolve-<slug> log --oneline -3
git -C .worktrees/resolve-<slug> show --stat HEAD                 # .docs/shipped/<slug>.md | 2 +-
git -C .worktrees/resolve-<slug> show HEAD | grep '^[-+]spec_hash'
```

**Recovery.** If that commit is exactly the one-line `spec_hash` change on top of the PR head,
fast-forward the feature worktree to it and push:

```bash
ai-conductor daemon status | grep "IN FLIGHT \[<slug>"           # must print nothing
cd .worktrees/<slug>
git merge --ff-only <fix-commit>
git push origin HEAD:feat/daemon-<slug>
```

If no such commit exists, regenerate the record as described in
[Shipped record reconciliation](shipped-record-reconciliation.md).

**Verification.** `gh pr checks <pr>` shows `shipped-record` passing on the new head.
