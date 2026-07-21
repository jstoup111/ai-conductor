---
name: intake
description: "Use when filing an intake issue to GitHub — capturing a bug, idea, or observation for a later DECIDE phase. Structures the issue as WHAT (observed evidence, impact) and desired OUTCOMES (observable acceptance signals), with verbatim logs/commands/repro artifacts a zero-context engineer can debug from. Never prescribes HOW — that belongs to DECIDE."
enforcement: gating
phase: decide
standalone: true
requires: [verify-claims]
---

## Purpose

Authors high-quality intake issues: the write-side twin of `/engineer`'s claim side.
An intake issue decides **WHAT** (the problem, its impact, its evidence) and highlights
**OUTCOMES** (what must be observably true when it's fixed). The engineer's DECIDE phase
owns **HOW**. A great intake issue lets a zero-context engineer start debugging
immediately — from the evidence in the issue alone — without anchoring them to the
filer's first idea of a fix.

This skill applies whether the filer is the operator (from chat or phone) or an agent
filing on the operator's behalf (halt monitor, retro proposals, bugs discovered
mid-build). GitHub's intake issue form (`.github/ISSUE_TEMPLATE/intake.yml`) scaffolds
the same shape on web/mobile; anything filed via `gh issue create` must follow it by
hand — this skill is how.

## The Intake Shape

Four sections. Three are required.

| Section | Required | Contents |
|---------|----------|----------|
| **Observed** | yes | Evidence of the problem — verbatim artifacts, not narrative |
| **Impact** | yes | One line minimum: who or what hurts, how often, what it costs / unblocks |
| **Desired outcome** | yes | Observable behavior that must hold afterward |
| **Hypotheses** | no | The filer's guesses about HOW — explicitly labeled as guesses |

## Practices

### 1. Gather Evidence First — While Context Is Warm

Collect concrete artifacts **before** writing a word of prose. Evidence is cheapest at
the moment of observation; an hour later the logs have rotated and the repro is fuzzy.

Collect whichever of these exist:

- **Exact commands + verbatim output.** Copy the real invocation and the real output,
  trimmed to the relevant lines. Never paraphrase an error message — the exact string
  is what the engineer will grep for.
- **Log excerpts with their source path and timestamp.** e.g. `.daemon/daemon.log`,
  `monitor.log`, CI run URLs. Include a few lines of surrounding context, not just the
  one scary line.
- **Precise references.** `file:line`, commit SHAs, PR/issue numbers, run IDs. These
  are *evidence*, and always welcome — a file path cited as proof is not a "how".
- **Reproduction steps.** The minimal sequence a zero-context reader could run to see
  the problem. State what you expected vs what happened.
- **Frequency and scope data.** How many times, since when, how widespread — a grep
  count, a ledger scan, "3 of the last 5 daemon runs". Turns anecdote into signal.
- **Environment facts** when plausibly relevant: versions, branch, config values.

**Calibrate every claim** (per `/verify-claims`): mark what you *observed directly*
versus what you *inferred* versus what you're *guessing*. Write inferences as
inferences — "the gate never fired (inferred: no gate line in daemon.log between
14:02–14:20)" — never as established fact. An intake built on an unlabeled guess sends
DECIDE down the wrong path with false confidence.

**Scale the bar to the claim.** A bug report needs verbatim evidence. An enhancement
idea needs the motivating observation ("I keep doing X by hand — see sessions A, B")
but not a forensic log dump. The convention must keep intake cheap to write — do not
demand ceremony that discourages filing from a phone.

### 2. Write **Observed** — Evidence, Not Narrative

Open with one or two sentences of orientation, then let artifacts carry the section:

```markdown
## Observed

The daemon re-dispatched the already-shipped `priority-banded-intake-claim` spec
after its slug was renamed. From `.daemon/daemon.log` (2026-07-04 09:12):

    09:12:03 dispatch: priority-banded-claim (eligible)
    09:12:03 marker check: .docs/intake/priority-banded-claim.md — not found
    09:14:41 opened PR #124

PR #124 duplicates merged PR #119 (same diff, `git range-diff` clean). The ledger
entry is keyed by the old slug string (`ledger.json:41`), so the rename made the
shipped spec invisible to dedup.
```

Rules of thumb:

- Verbatim beats summary. Indent or fence raw output; keep exact error strings intact.
- Trim aggressively but honestly — elide with `[...]`, never reword inside a quote.
- Every artifact names its source (path, URL, command) so the engineer can pull more.
- Long evidence (full logs, big diffs) goes in a `<details>` block or a gist link,
  with the load-bearing lines quoted inline.

### 3. Write **Impact** — Who Hurts, How Often (REQUIRED)

**Required on every intake — one line minimum.** State the value of fixing it: who or
what hurts, how often, and/or what it unblocks. This is what lets the operator assign
a priority band honestly:

```markdown
## Impact

Every slug rename risks a duplicate build: wasted daemon cycle (~20 min), a duplicate
PR the operator must triage and close. Happened twice this week (#124, #131).
```

If the honest answer is "minor annoyance, no data loss" — write that. Overstated
impact erodes the priority bands for everything else.

**Sizing is NOT prose — it's a label.** Do not write effort estimates into the body;
apply exactly one `size: S` / `size: M` / `size: L` label instead (see §8). A very
rough tier is all DECIDE needs: S ≈ ~1-2h, M ≈ ~half day to a day, L ≈ multi-day.

### 4. Write **Desired outcome** — Observable, Not Implementational

State the behavior that must hold **after** the work ships, in terms an engineer could
verify **without knowing how it was fixed**. These become acceptance signals for
DECIDE's stories.

The litmus test: *could someone confirm this outcome by observing the system, with the
implementation hidden from them?*

- ✅ "A spec that already shipped is never re-dispatched, even if its slug, title, or
  file path changed since shipping."
- ✅ "When dedup blocks a dispatch, the daemon logs which shipped record matched."
- ❌ "Key the ledger by content hash instead of slug." — that's a HOW; move it to
  Hypotheses.
- ❌ "Fix the dedup logic." — not observable; restate as the behavior that proves
  it's fixed.

Prefer several small, independently-checkable outcomes over one broad one. Include
the negative-path outcome when there is one ("...and a *legitimately new* spec with a
similar name still dispatches").

### 5. Quarantine Every HOW into **Hypotheses**

While gathering evidence you will inevitably form a theory of the fix. Do not delete
it — and do not let it leak into the other sections. Route it:

- If the thought is really an *outcome in disguise*, restate it observably and put it
  in Desired outcome ("add a log line" → "the daemon logs which record matched").
- Otherwise it goes under `## Hypotheses`, explicitly framed as a guess:

```markdown
## Hypotheses

Filer's guesses — DECIDE weighs alternatives and may discard these:

- Ledger dedup appears keyed by the slug string (`ledger.json:41`); a content-derived
  anchor (spec hash?) might survive renames.
- Might also be fixable at rename time instead (migrate the ledger key).
```

Signals that a HOW is leaking outside Hypotheses: "add a…", "refactor…", "change X to
Y", "introduce a…", named functions/seams/files *prescribed as the change* (as opposed
to cited as evidence), design sketches, proposed schemas. Sweep the draft for these
before filing.

Why this is a hard rule: an embedded design anchors the engineer's `/explore` toward
the filer's first idea and skips the divergent half of DECIDE. Labeled hypotheses enter
`/explore` as *one candidate among alternatives* (its Embedded Design Divergence Rule)
— they can still win, but on merits, not by default.

### 6. Title the Issue by Symptom or Outcome — Never by Solution

- ✅ `Shipped spec re-dispatched after slug rename`
- ✅ `Intake convention: issues state WHAT and desired OUTCOMES`
- ❌ `Key dedup ledger by content hash` — prescribes the fix in the title, the
  strongest anchor of all.

Keep it specific and under ~72 characters.

### 7. GATE — Pre-File Checklist

**Do not file until every applicable check passes.** Fix the draft, not the checklist.

1. **Observed contains at least one verbatim artifact** (command + output, log
   excerpt, or precise reference) — not narrative alone. *(Bug reports: mandatory.
   Idea/enhancement intakes: the motivating observation suffices.)*
2. **Every Desired outcome passes the litmus test** — verifiable by observation
   without knowing the implementation.
3. **No HOW outside Hypotheses** — sweep for the leak signals in §5.
4. **Claims are calibrated** — inferences and guesses are labeled as such, not stated
   as fact.
5. **Impact is stated honestly** — required, one line minimum; never omitted.
6. **Size/priority are ready to hand to the filer**: either you've picked
   `S`/`M`/`L` and (optionally) a priority tier to pass as flags in §8, or you're
   content to let `bin/intake-file` infer/prompt/default them. Never hand-write a
   size or priority as prose in the body — that discipline is now enforced by the
   script, not the checklist.

### 8. File It

Filing is not prose discipline — it is one atomic, deterministic operation run by
`bin/intake-file` (`src/conductor/bin/intake-file`, backed by `fileIntakeIssue()`
in `src/engine/engineer/intake/file-issue.ts`). It creates the issue, applies the
`priority:`/`size:` labels, and records a `--depends-on` link — or an explicit
"no dependencies" decision when `--depends-on` is omitted — in one call, so there
is never a window where an issue exists unlabeled or with a silently-skipped
dependency check.

```bash
bin/intake-file \
  --title "<symptom-or-outcome title>" \
  --body "$(cat <<'EOF'
## Observed

<evidence>

## Impact

<one line minimum: who/what hurts, how often, what fixing it unblocks>

## Desired outcome

- <observable signal 1>
- <observable signal 2 (negative path)>

## Hypotheses

Filer's guesses — DECIDE weighs alternatives and may discard these:

- <guess>
EOF
)" \
  --size M \
  --priority high \
  --depends-on owner/repo#123
```

- **`--title` and `--body` are required**; the script exits non-zero without them.
- **`--size S|M|L`** (optional): if omitted, the script prompts interactively when
  attached to a TTY, otherwise infers from body wording, otherwise defaults to `M`
  — always reported back as `size=<value> (<source>)` so the filer sees which path
  was taken. Never write the size as prose in the body; let the flag/inference own it.
- **`--priority critical|high|medium|low`** (optional): same prompt ▸ infer ▸
  default resolution as size, reported as `priority=<value> (<source>)`.
- **`--depends-on owner/repo#N`** (repeatable, optional): links a blocking issue.
  Omitting it entirely is fine — the script records an explicit
  `dependencies: none` rather than silently skipping the question, so "no
  dependencies" is always a decision, never an omission.
- **`--repo owner/repo`** (optional): target a repo other than the current one.
- The script assigns the filer via the normal `gh issue create` invocation it
  wraps; a label-apply or `--depends-on` link failure after successful issue
  creation surfaces as a `[intake-file] warning: ...` line and does **not** fail
  the filing (exit 0) — only a failure to create the issue itself is a hard error
  (non-zero exit).
- Impact is never omitted from the body. A Hypotheses section with nothing to say
  is dropped entirely, not left as an empty heading.
- After running, report the printed `[intake-file] filed: <url>` line (and any
  warnings) to the operator.

## Worked Example — Bad vs Good

**Bad (solution-shaped — most of what this skill exists to prevent):**

> **Title:** Add content-hash dedup to the ledger
>
> The ledger dedups by slug. We should key it by a hash of the spec content instead.
> Add a `spec_hash` column, compute it at ship time, and check it at dispatch.

Everything here is HOW. There's no evidence, no impact, and the only "outcome" is the
filer's design. DECIDE has nothing to weigh and everything to anchor on.

**Good (same underlying problem):**

> **Title:** Shipped spec re-dispatched after slug rename
>
> **Observed:** daemon.log excerpt showing the re-dispatch, PR #124 vs merged #119
> range-diff, `ledger.json:41` showing the slug-string key. *(as in §2 above)*
>
> **Impact:** duplicate build per rename; twice this week.
>
> **Desired outcome:** shipped specs never re-dispatch across renames; dedup blocks
> log their matching record; genuinely new specs still dispatch.
>
> **Hypotheses:** *(content-hash anchor idea lives here, labeled as a guess)*

## Verify

- [ ] Issue has Observed, Impact (one line minimum), and Desired outcome sections; Hypotheses only if non-empty
- [ ] Observed leads with verbatim artifacts, each naming its source
- [ ] Inferences and guesses are labeled, not stated as fact
- [ ] Every outcome is observable without knowledge of the implementation
- [ ] No fix directions, design sketches, or prescribed seams outside Hypotheses
- [ ] Title states the symptom or outcome, not a solution
- [ ] Filed via `bin/intake-file`; `size=` reported in its output; `priority=` applied if warranted; `--depends-on` given or an explicit `dependencies: none` accepted
- [ ] Issue URL reported to the operator
