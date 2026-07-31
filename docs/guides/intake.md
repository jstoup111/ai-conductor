---
title: Filing intake issues
parent: Guides
nav_order: 3
---

# Filing intake issues

File an issue that a zero-context engineer can start debugging from, and that seeds the DECIDE phase
without anchoring it. For anyone capturing a bug, an idea, or an observation — operator or agent.

An intake issue decides **WHAT** (the problem, its impact, its evidence) and states desired
**OUTCOMES** (what must be observably true afterwards). It never prescribes **HOW** — that belongs
to DECIDE.

## Prerequisites

| Requirement | Check |
| --- | --- |
| `gh` authenticated for the target repo | `gh auth status` |
| A harness checkout containing `bin/intake-file` | `<harness-checkout>/bin/intake-file` (prints usage, exit 1) |

`bin/install` symlinks only `conduct-ts` (and the legacy `conduct`) into `~/.local/bin`, so
`intake-file` is never on `PATH`. Run it from the harness checkout, or call it by absolute path
from anywhere. It always executes inside the harness's own engine directory, so a bare invocation
files into the harness repo — pass `--repo <owner>/<repo>` to target any other repo, including the
project you are standing in.

Filing from the GitHub web or mobile UI works too: the issue form at
`.github/ISSUE_TEMPLATE/intake.yml` scaffolds the same shape. Anything filed with a bare
`gh issue create` has to follow it by hand.

The two routes are labelled by different owners, and only one of them defaults. A form submission
arrives with no labels, so the `intake-label-sync` Action reads its Priority and Size fields and
stamps them — falling back to `priority: medium` / `size: M` when a field is blank or unparsable.
An issue filed with `bin/intake-file` is already labelled by the command itself, so the Action
recognises it as a non-form body and skips it. Without that skip the Action's defaults would be
*added* alongside the filer's choice rather than replacing it, leaving the issue carrying two
contradictory bands.

## The shape

Four sections. Three are required.

| Section | Required | Contents |
| --- | --- | --- |
| **Observed** | yes | Evidence of the problem — verbatim artifacts, not narrative |
| **Impact** | yes | One line minimum: who or what hurts, how often, what it costs or unblocks |
| **Desired outcome** | yes | Observable behavior that must hold afterwards |
| **Hypotheses** | no | The filer's guesses about HOW, explicitly labelled as guesses |

## Step 1 — Gather evidence while context is warm

Collect artifacts **before** writing prose. An hour later the logs have rotated and the repro is
fuzzy. Collect whichever of these exist:

- **Exact commands and verbatim output.** Copy the real invocation and the real output, trimmed to
  the relevant lines. Never paraphrase an error string — the exact text is what the engineer greps
  for.
- **Log excerpts with source path and timestamp.** `.daemon/daemon.log`, a CI run URL, a monitor log.
  Include surrounding context, not just the one scary line.
- **Precise references.** `file:line`, commit SHAs, PR and issue numbers, run ids. A file path cited
  as proof is evidence, not a "how".
- **Reproduction steps.** The minimal sequence a zero-context reader could run. State what you
  expected and what happened.
- **Frequency and scope.** A grep count, a ledger scan, "3 of the last 5 daemon runs". This turns
  anecdote into signal.
- **Environment facts** when plausibly relevant: versions, branch, config values.

Calibrate every claim: mark what you observed directly, what you inferred, and what you are
guessing. Write an inference as an inference — "the gate never fired (inferred: no gate line in
daemon.log between 14:02 and 14:20)" — never as fact.

Scale the bar to the claim. A bug report needs verbatim evidence. An enhancement idea needs the
motivating observation and nothing more. Intake must stay cheap enough to file from a phone.

## Step 2 — Write Observed

One or two sentences of orientation, then let the artifacts carry the section.

```markdown
## Observed

The daemon re-dispatched the already-shipped `priority-banded-intake-claim` spec
after its slug was renamed. From `.daemon/daemon.log` (2026-07-04 09:12):

    09:12:03 dispatch: priority-banded-claim (eligible)
    09:12:03 marker check: .docs/intake/priority-banded-claim.md — not found
    09:14:41 opened PR #124

PR #124 duplicates merged PR #119 (same diff, `git range-diff` clean). The ledger
entry is keyed by the old slug string (`ledger.json:41`).
```

Rules of thumb:

- Verbatim beats summary. Fence or indent raw output; keep error strings intact.
- Trim aggressively but honestly. Elide with `[...]`; never reword inside a quote.
- Every artifact names its source, so the engineer can pull more.
- Long evidence goes in a `<details>` block or a gist, with the load-bearing lines inline.

## Step 3 — Write Impact

Required, one line minimum. State who or what hurts, how often, and what fixing it unblocks. This is
what lets the operator assign a priority band honestly.

```markdown
## Impact

Every slug rename risks a duplicate build: a wasted daemon cycle (~20 min) plus a
duplicate PR the operator must triage and close. Happened twice this week (#124, #131).
```

If the honest answer is "minor annoyance, no data loss", write that. Overstated impact erodes the
bands for everything else.

Sizing is a label, not prose. Do not write effort estimates into the body — pass `--size S|M|L`
instead (step 8).

## Step 4 — Write Desired outcome

State the behavior that must hold **after** the work ships, in terms an engineer could verify without
knowing how it was fixed. These become the acceptance signals DECIDE turns into stories.

The litmus test: could someone confirm this outcome by observing the system, with the implementation
hidden from them?

| Verdict | Example |
| --- | --- |
| Good | "A spec that already shipped is never re-dispatched, even if its slug, title, or file path changed since shipping." |
| Good | "When dedup blocks a dispatch, the daemon logs which shipped record matched." |
| Bad — a HOW | "Key the ledger by content hash instead of slug." |
| Bad — not observable | "Fix the dedup logic." |

Prefer several small, independently checkable outcomes over one broad one, and include the
negative-path outcome when there is one ("…and a legitimately new spec with a similar name still
dispatches").

## Step 5 — Quarantine every HOW into Hypotheses

You will form a theory of the fix while gathering evidence. Do not delete it, and do not let it leak
into the other sections. Route it:

- If it is really an outcome in disguise, restate it observably and move it to Desired outcome
  ("add a log line" becomes "the daemon logs which record matched").
- Otherwise it goes under `## Hypotheses`, framed as a guess:

```markdown
## Hypotheses

Filer's guesses — DECIDE weighs alternatives and may discard these:

- Ledger dedup appears keyed by the slug string (`ledger.json:41`); a content-derived
  anchor might survive renames.
- Might also be fixable at rename time instead (migrate the ledger key).
```

Leak signals to sweep for before filing: "add a…", "refactor…", "change X to Y", "introduce a…",
named functions or seams prescribed as the change (as opposed to cited as evidence), design
sketches, proposed schemas.

Why this is a hard rule: an embedded design anchors `/explore` on the filer's first idea and skips
the divergent half of DECIDE. A labelled hypothesis enters `/explore` as one candidate among
alternatives — it can still win, but on merits.

## Step 6 — Title by symptom or outcome

| Verdict | Title |
| --- | --- |
| Good | `Shipped spec re-dispatched after slug rename` |
| Good | `Intake convention: issues state WHAT and desired OUTCOMES` |
| Bad | `Key dedup ledger by content hash` — prescribes the fix in the strongest anchor position |

Keep it specific and under about 72 characters.

## Step 7 — Check before filing

Do not file until every applicable check passes. Fix the draft, not the checklist.

1. Observed contains at least one verbatim artifact — not narrative alone. Mandatory for bug
   reports; for an idea or enhancement, the motivating observation suffices.
2. Every Desired outcome passes the litmus test.
3. No HOW outside Hypotheses.
4. Inferences and guesses are labelled as such.
5. Impact is stated honestly, one line minimum, never omitted.
6. Size and priority are ready to pass as flags, or you are content to let the filer infer them.
   Never hand-write either as prose in the body.

## Step 8 — File it

Filing is one atomic operation: it creates the issue, applies the `priority:` and `size:` labels, and
records a `--depends-on` link — or an explicit "no dependencies" decision — in a single call, so
there is never a window where an issue exists unlabelled.

Run this from the harness checkout, or substitute its absolute path for `bin/intake-file`.

```bash
bin/intake-file \
  --title "<symptom-or-outcome title>" \
  --body "$(cat <<'EOF'
## Observed

<evidence>

## Impact

<one line minimum: who or what hurts, how often, what fixing it unblocks>

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
  --depends-on <owner/repo#123>
```

| Flag | Required | Notes |
| --- | --- | --- |
| `--title` | yes | Missing title or body prints usage and exits 1 |
| `--body` | yes | |
| `--size S\|M\|L` | no | Omitted: prompts on a TTY, otherwise infers from body wording, otherwise defaults to `M`. Always reported as `size=<value> (<source>)`. An invalid value errors. |
| `--priority critical\|high\|medium\|low` | no | Same prompt, infer, default resolution; reported as `priority=<value> (<source>)`. |
| `--depends-on <owner/repo#N>` | no | Repeatable. Omitting it records an explicit `dependencies: none` rather than skipping the question. |
| `--repo <owner/repo>` | no | Target a repo other than the harness repo. Required whenever the issue belongs to your project. |

You should see `[intake-file] filed: <url>`. A label-apply or dependency-link failure after the issue
is created surfaces as `[intake-file] warning: …` and does **not** fail the filing; only a failure to
create the issue itself is a hard error. Report the URL and any warnings to the operator.

## From issue to backlog

An intake issue does not reach the daemon by itself. The path is:

1. **Poll.** `conduct-ts engineer poll`, or the intake loop, sweeps GitHub issues into the durable
   inbox. The ledger dedups, so a repeat poll enqueues nothing new.
2. **Claim.** `conduct-ts engineer claim` dequeues the oldest unblocked idea and persists a claim
   record carrying the Desired-outcome bullets.
3. **DECIDE.** The [engineer loop](engineer-loop.md) authors the full spec artifact set in a per-idea
   worktree and lands them on a `spec/<slug>` branch.
4. **Merge.** You merge the spec PR. Only then do the artifacts exist on the default branch.
5. **Build.** The daemon reads `.docs/plans` from the committed default-branch tree and dispatches
   the spec. See [running the daemon](running-the-daemon.md).

An issue that is blocked by another open issue is held back at step 2 — `claim` reports
`{"allBlocked":true, …}` rather than handing you work that cannot land.

## The intake marker

When a spec lands, the engineer commits `.docs/intake/<slug>.md` alongside it. This is how the
originating issue and the spec's owner travel with the spec onto the default branch, where the daemon
can read them — the daemon never sees the intake ledger.

```markdown
# Intake origin: <slug>

Source-Ref: <owner/repo#N>
Owner: <owner-id>

## Desired outcome

- <bullets carried verbatim from the claim record>
```

| Line | Written when | Read by |
| --- | --- | --- |
| `Source-Ref:` | The idea came from an intake source | The daemon, to put `Closes <owner/repo#N>` on the implementation PR so the merge closes the issue |
| `Owner:` | An owner identity resolved at land time (configured `spec_owner`, else the `gh` login) | The daemon's owner gate, via `git show <base>:.docs/intake/<slug>.md` |

Both lines are optional and the marker is written only when at least one of them applies — a
hand-authored, non-intake, un-owned spec produces no marker at all. A blank `Owner:` line is never
written: absent means un-owned, not falsely owned.

The `Owner:` stamp decides who builds the spec. A spec stamped with the daemon's own owner builds; a
spec stamped with a different owner is skipped as `other-owner`. An un-owned spec always builds — the
configured cutover only changes the logged reason. See
[configuration reference](../reference/configuration.md) for `spec_owner` and `owner_gate_cutover`,
and [artifacts reference](../reference/artifacts.md) for the marker's full field list.
