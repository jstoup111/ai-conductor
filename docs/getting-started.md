# Getting Started

Relocated from README.md — see [README.md](../README.md) for the project front door.

## Install

```bash
git clone git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
```

This symlinks all 20 skills into `~/.claude/skills/` and installs the conductor CLI(s) to
`~/.local/bin/`. `./bin/install` also builds the TypeScript conductor bundle for you —
it runs `npm install && npm run build` in `src/conductor/` (in both first-run and
`--update` mode) and symlinks `conduct-ts` once the bundle exists. The build needs
Node >= 20.5 (the repo pins 20.19.2 via `.tool-versions`); if Node is too old or `npm`
is missing, the build is skipped with a warning and `conduct` still installs. See
[Choosing a Conductor](choosing-a-conductor.md) — both binaries coexist, `conduct`
is the default, `conduct-ts` is opt-in.

**Mermaid renderer.** `./bin/install` also offers a renderer for the architecture diagrams
and ADRs the harness generates, so you review them as visuals (not raw Mermaid) at the
approval gates. Pick a preset — `html` (default: a self-contained mermaid.js page opened in
your default browser; no native dependencies, works anywhere), `mmdc-png`/`mmdc-svg` (static
images via [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli)), or `none`.
The choice is stored as `mermaid_renderer` in `~/.ai-conductor/config.yml` and reused on every
run; under `conduct-ts` diagrams render automatically when an artifact is presented for
approval, or run `conduct render-diagrams <file.md>...` on demand. The opener is detected per
platform (macOS `open`, Linux `xdg-open`, WSL `wslview`/`explorer.exe`). With no renderer
configured, diagrams fall back to raw Markdown — never a blocker.

The `mmdc-*` presets need Chromium. On WSL, in containers, or when running as root — where
Chromium's setuid sandbox can't initialize — the renderer automatically launches with
`--no-sandbox` (and an explicit Chrome `executablePath` when a system Chrome is found). To take
full control of how Chromium launches, drop a Puppeteer config at `~/.ai-conductor/puppeteer.json`
(e.g. `{ "executablePath": "/usr/bin/google-chrome", "args": ["--no-sandbox"] }`); when present it
overrides the auto-detection.

Verify:

```bash
./bin/install --check
```

Update (after pulling new changes):

```bash
git pull
./bin/install
```

Uninstall:

```bash
./bin/install --uninstall
```

**Worktree-root guard.** Global-mutating installs (default and `--update` modes) refuse to run
when the installer's own checkout physically resolves under a `.worktrees/` directory — a build
worktree is deleted at ship time, so installing from one would leave every global bin, skill
symlink, and `settings.json` hook path dangling (issue #363). The guard resolves the physical
path (`pwd -P`), so a symlinked path can't hide it. `--check`, `--help`, and `--uninstall` are
unaffected. To deliberately install from a worktree anyway, pass `--allow-worktree-root`
(combinable with any mode, inert on a normal checkout):

```bash
./bin/install --update --allow-worktree-root
```

## What Your Project Gets

After running `/bootstrap` on a project, it creates:

```
your-project/
├── .claude/
│   └── settings.json        # Project-scoped Read/Edit/Write permissions +
│                            # pre-PR lint hook (PreToolUse on gh pr create)
├── .memory/                 # Cross-session knowledge
│   ├── decisions/
│   ├── patterns/
│   ├── gotchas/
│   └── context/
├── .pipeline/               # Pipeline state (if using /pipeline)
│   ├── task-status.json
│   ├── summary.json         # Written at final-task completion; retro reads this
│   └── audit-trail/
│       ├── batch-N/         # Evaluator verdicts (review.json per batch)
│       └── autoheal-*.json  # Conductor auto-heal records (TS conductor only)
├── .docs/
│   ├── specs/               # Design docs from /prd
│   ├── stories/             # User stories from /stories
│   ├── conflicts/           # Conflict reports from /conflict-check
│   ├── plans/               # Implementation plans from /plan
│   ├── decisions/           # ADRs (API contract, styleguide, etc.)
│   ├── architecture/        # C4 diagrams from /architecture-diagram
│   │   ├── system-context.md
│   │   ├── containers.md
│   │   ├── components.md
│   │   ├── sequences/
│   │   └── erd.md
│   └── retros/              # Retrospective reports from /retro
├── .github/
│   └── pull_request_template.md  # Changelog + Migration scaffolding
└── CLAUDE.md                # Project-specific harness config
```

Bootstrap detects your stack (Node+TS, Rails+Rubocop, Python+ruff/mypy, Rust+clippy,
Go+vet) and writes the lint command into `.claude/settings.json` as a `PreToolUse(Bash)`
hook with `if: "Bash(gh pr create*)"`. Linting becomes fully deterministic machinery —
TDD, pipeline, and code-review skills never invoke the linter themselves. Non-zero
exit from the lint command blocks the PR; users edit the command in place.

## Adding Tech-Context for New Stacks

See `tech-context/FORMAT.md` for the contract. Each stack gets a directory with up to 4 files:

```
tech-context/<framework>-<database>/
├── tdd.md        # Test framework, factories, assertions, patterns
├── stories.md    # Stack-specific negative path categories
├── review.md     # Security checklist, performance checklist, antipatterns
└── debugging.md  # Tools, log locations, common gotchas
```
