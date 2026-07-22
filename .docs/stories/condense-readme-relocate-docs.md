**Status:** Accepted

# Stories: Condense README to a front-door; relocate reference into `docs/`

Track: **technical** · Complexity: **Small** · Source-Ref: `jstoup111/ai-conductor#787`

These stories cover Approach A: condense the 2139-line root `README.md` into a short
front-door, and relocate the detailed build/use/configure/daemon/telemetry/architecture
reference into an in-repo `docs/` topic tree (beside the existing `docs/runbooks/`),
losing no information and leaving every cross-reference intact. GitHub Pages wiring is
**out of scope** here (tracked separately as `#831`, depends on this).

## Target structure (reference for the plan — acceptance is stated observably below)

**README.md keeps (condensed front-door):** title + one-paragraph goal/what-it-does;
`## Requirements`; a condensed `## Install`; a short `## How the Pieces Fit Together`; a
**minimal** end-to-end `## Quick Start` (depth relocated to `docs/getting-started.md`); a
new `## Documentation` index that links to every `docs/` guide, `docs/runbooks/`, and
`src/conductor/README.md`; `## Key Design Principles`.

**Relocated into `docs/` topic guides (no content lost):**

| Current README section(s) | Destination guide |
|---|---|
| `Choosing a Conductor`, `Command syntax and unknown-command guard` | `docs/choosing-a-conductor.md` |
| Fuller install / `How the Pieces Fit Together` detail / `What Your Project Gets` / `Adding Tech-Context for New Stacks` | `docs/getting-started.md` |
| `Configuration` → `Full reference`, `Model fallback ladder`, `Operator identity & owner gate`, `Harness self-host guardrails`, `Plugins` | `docs/configuration.md` |
| `halt-issues sweep`, `overlap-scan`, `Priority scheduling`, `Rate-Limit Episode Coordination`, `Halt-PR presentation reliability`, `Claim-time delivery guard and recovery`, `Brain Loop Supervision`, `Sandbox auth-expiry park-and-poll`, `Daemon build-auth` | `docs/daemon-operations.md` |
| `Attribution enforcement`, `Task-stamp telemetry and attribution spot-audit`, `OpenTelemetry observability`, `Intra-step build progress & stall events` | `docs/observability.md` |
| `Intake-Issue Shape: WHAT vs. HOW`, `Intake-Only Criteria Enforcement` | `docs/intake.md` |
| `How It Works` (SDLC Flow, Skills, Agent Personas, Enforcement Levels, Tech-Context), `TypeScript Conductor (src/conductor/)`, `Project Structure` | `docs/architecture.md` |

`src/conductor/README.md` (the ~3703-line engine reference) is **not** moved or folded —
it stays as-is and is linked from `docs/` and the README Documentation index.

The plan MAY refine these file boundaries, but every listed source section MUST land in
exactly one `docs/` guide and remain reachable from the README (§ Story 4).

---

## Story 1: README is a short front-door

**Requirement:** Desired-outcome — "README condensed to goals + what-it-does + quick start (+ links out)"

As a newcomer evaluating the project, I want the root `README.md` to read top-to-bottom in
a couple of minutes so that I learn what the project is and how to start without wading
through operational reference.

### Acceptance Criteria

#### Happy Path
- Given the relocation has landed, when I open `README.md`, then it contains, in order: a
  one-paragraph goal/what-it-does, `## Requirements`, `## Install`, `## How the Pieces Fit
  Together`, `## Quick Start`, `## Documentation`, and `## Key Design Principles` — and no
  deep reference sections (no `Configuration → Full reference`, no daemon-ops runbooks, no
  telemetry key dumps) remain inline.
- Given the condensed README, when its length is measured, then `wc -l README.md` is **≤ 300**
  (down from 2139).
- Given `## Quick Start`, when read, then it presents a minimal end-to-end path and links to
  `docs/getting-started.md` for depth (it is not the previous ~250-line walkthrough).

#### Negative Paths
- Given the condensed README, when any heading that the target-structure table marks for
  relocation still appears as an inline section body in `README.md` (not merely as a link),
  then acceptance FAILS — the section was not relocated.

### Done When
- [ ] `wc -l README.md` ≤ 300
- [ ] `README.md` top-level headings are exactly the front-door set above (verified by
      `grep -nE '^## ' README.md`); none of the relocated section headings appear as inline
      bodies
- [ ] `## Quick Start` contains a working minimal end-to-end example and a link to
      `docs/getting-started.md`

---

## Story 2: A `## Documentation` index links to every guide

**Requirement:** Desired-outcome — "condensed README links out to the relocated detailed docs"

As a reader who needs the detail, I want a Documentation section in the README that indexes
every relocated guide so that nothing is more than one click away.

### Acceptance Criteria

#### Happy Path
- Given the condensed README, when I read `## Documentation`, then it links to every file
  created under `docs/` (each topic guide), to `docs/runbooks/`, and to
  `src/conductor/README.md`, each with a one-line description of what it covers.
- Given each link in `## Documentation`, when followed, then it resolves to an existing
  in-repo file (no 404 / missing target).

#### Negative Paths
- Given a `docs/*.md` guide produced by this work, when it is **not** referenced (directly or
  transitively) from the README `## Documentation` index, then acceptance FAILS — an orphaned
  guide is unreachable from the front door.

### Done When
- [ ] `## Documentation` exists in `README.md` and links to every `docs/*.md` topic guide, to
      `docs/runbooks/`, and to `src/conductor/README.md`
- [ ] Every relative link in `## Documentation` resolves to a file that exists in the repo
- [ ] No `docs/*.md` topic guide created by this work is missing from the index

---

## Story 3: All reference content is relocated with zero loss

**Requirement:** Desired-outcome — "detailed material relocated into docs/ … no information is lost, only moved"

As a maintainer, I want every deep-reference section that leaves the README to reappear
verbatim (or lightly re-headed) in a `docs/` guide so that no documentation is lost in the move.

### Acceptance Criteria

#### Happy Path
- Given each source section in the target-structure table, when the work lands, then its
  content exists in the mapped `docs/` guide and is substantively identical to the
  pre-change README content (headings preserved; prose not dropped or summarized away).
- Given the new `docs/` guides, when listed, then they sit beside the existing
  `docs/runbooks/` (the runbooks are untouched).

#### Negative Paths
- Given the pre-change README, when a reader searches for any distinctive phrase from a
  relocated section (e.g. a config key name, a runbook step, an event field), then it is
  found somewhere in `docs/` — a phrase present before the change but absent from both the
  new `README.md` and `docs/` after it means content was lost, and acceptance FAILS.

### Done When
- [ ] Each source section in the target-structure table is present in its mapped `docs/` guide
- [ ] `docs/runbooks/` is unchanged (both existing runbook files still present)
- [ ] A spot-check of distinctive strings (≥ 1 per relocated section: a config key, a
      subcommand name, an event/field name) finds each one under `docs/`

---

## Story 4: Cross-references stay intact (no dangling links)

**Requirement:** Desired-outcome — "cross-references intact … nothing that pointed at the old README sections dangles"

As anyone following a link, I want every internal reference to resolve after the move so that
relocation does not break navigation.

### Acceptance Criteria

#### Happy Path
- Given the condensed README, when its internal anchor links (e.g. `[Choosing a
  Conductor](#choosing-a-conductor)`) are checked, then each either points at a heading that
  still exists in `README.md` or is rewritten to point at the relocated guide.
- Given every relative Markdown link in `README.md` and in the new `docs/*.md` guides, when
  resolved, then each targets an existing file/anchor in the repo.

#### Negative Paths
- Given a link that previously pointed at a `README.md` section now moved to `docs/`, when it
  is not rewritten to the new location, then acceptance FAILS (a dangling in-repo link).
- Given a relocated guide that links back to `README.md#some-anchor`, when that anchor no
  longer exists in the condensed README, then acceptance FAILS.

### Done When
- [ ] A link check over `README.md` + all `docs/*.md` reports **zero** broken relative links
      or intra-repo anchors (e.g. via a markdown link-check run in the build)
- [ ] The README's `#choosing-a-conductor` self-links resolve (heading kept or link retargeted)
- [ ] No `docs/` guide references a `README.md` anchor that the condensed README no longer has

---

## Story 5: "Docs track features" pointers name the new locations

**Requirement:** Convention constraint — `CLAUDE.md` "Docs track features"; discoverability preserved

As a contributor (human or the daemon) who must update docs in the same PR as a change, I want
the doc-upkeep instructions to name the relocated guides so that future updates land in the
right file instead of the old monolithic README.

### Acceptance Criteria

#### Happy Path
- Given `CLAUDE.md`'s "Documentation Upkeep" section (which currently says "update `README.md`
  and `src/conductor/README.md`"), when read after the change, then it names the relevant
  `docs/` guides as the update target for the relocated topics (e.g. config-key changes →
  `docs/configuration.md`; daemon options → `docs/daemon-operations.md`).
- Given `src/conductor/README.md`'s references to the root README's relocated sections, when
  read after the change, then they point at the new `docs/` locations (or are left valid).

#### Negative Paths
- Given the doc-upkeep instructions after the change, when they still direct all updates only
  to `README.md` for a topic that now lives under `docs/`, then acceptance FAILS — the
  convention would send future edits (and the daemon's same-PR doc updates) to the wrong file.

### Done When
- [ ] `CLAUDE.md`'s Documentation Upkeep / "Docs track features" guidance references the new
      `docs/` guide(s) for relocated topics, not only `README.md`
- [ ] Any `src/conductor/README.md` link that targeted a now-moved root-README section resolves
      to the new `docs/` location
- [ ] `HARNESS.md`'s own "Docs track features" convention line (if it names README) is
      reconciled with the new structure or confirmed still accurate
