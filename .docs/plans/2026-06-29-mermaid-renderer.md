# Implementation Plan: Mermaid Diagram Renderer

**Spec:** `.docs/specs/2026-06-29-mermaid-renderer.md`
**Stories:** `.docs/stories/mermaid-renderer.md`
**Date:** 2026-06-29
**Complexity:** SMALL → direct `/tdd`

> **Scope decision:** conduct-ts only. `bin/conduct` is legacy and is NOT touched.
> Render logic lives in TypeScript; `bin/install` (the bash installer) gains the
> setup/menu step. Default renderer = `html`.

---

## Design Decisions (the "how" deferred from the PRD)

### D1 — `mermaid_renderer` config block, parallel to `markdown_viewer`
A new validated block in `.ai-conductor/config.yml` (user + project, deep-merged):
```yaml
mermaid_renderer:
  preset: html        # which preset was chosen
  command: ...        # tool ({file}=source md, {out}=output path); empty for html/none
  args: [ ... ]       # array of strings, like markdown_viewer.args
  mode: external      # inline | blocking | external (same semantics as markdown_viewer.mode)
```
Validated and typed exactly like `markdown_viewer`
(`src/engine/config.ts:393–516`, `MarkdownViewerConfig` at `src/types/config.ts:223`).

### D2 — Preset list (default = `html`)
| key | label | tool needed | renders by | default? |
|-----|-------|-------------|------------|----------|
| `html` | HTML preview (browser) | none (a browser opener) | self-contained HTML embedding diagrams + `mermaid.min.js`, opened in browser | **yes** |
| `mmdc-png` | PNG (mermaid-cli) | `@mermaid-js/mermaid-cli` (`mmdc`) + Chromium | render each diagram → PNG, open | no |
| `mmdc-svg` | SVG (mermaid-cli) | `mmdc` + Chromium | render each diagram → SVG, open | no |
| `none` | disabled (raw Markdown) | none | skip — raw Markdown only | no |

`html` is default: no native Chromium, opens in the Windows browser on WSL2 via
`wslview`, zoomable. `mmdc-*` is opt-in and degrades gracefully (Story 5).

### D3 — Platform opener (in TS)
A helper detects, in order: `wslview` → `explorer.exe` (WSL) → `xdg-open` (Linux) →
`open` (macOS). Injectable for tests (no GUI launched in CI). If none found, print
the produced file path instead.

### D4 — One render module, two entry points
`src/engine/mermaid-renderer.ts` owns all logic. Reached via:
- the **gate**: `reviewArtifacts` (conduct-ts) calls it for mermaid-bearing files;
- a **CLI subcommand** `conduct-ts render-diagrams <file>...` so skills/users invoke
  it directly (and the SKILL.md advisory path can call it).

---

## Tasks

### Group A — Config schema + presets [Stories 1,2; FR-2]
- **A1.** `src/engine/mermaid-renderer-presets.ts`: preset table + `VALID_MERMAID_RENDERER_MODES`,
  parity with `md-viewer-presets.ts` (keep the "keep in sync" comment).
- **A2.** `src/types/config.ts`: add `MermaidRendererConfig` type and
  `HarnessConfig.mermaid_renderer?` (mirror `MarkdownViewerConfig` at `:223`).
- **A3.** `src/engine/config.ts`: add `validateMermaidRendererBlock`, wire into the
  validator (mirror `:393–516`), and add `mermaid_renderer` to the allowed-keys list
  (`:145`). Negative path (Story 2): malformed block → validation_error, not a crash.

### Group B — Render module [Stories 3,4,5; FR-3,4,5]
- **B1.** `src/engine/mermaid-renderer.ts`: `extractMermaidBlocks(content)` → array of
  fenced ```mermaid sources. Empty → no-op (Story 4: ADR with no diagram).
- **B2.** `openFile(path, opener)` per D3 (injectable opener).
- **B3.** `preset=none` / no config → return a one-line notice string, no render
  (Story 5 happy). `mode` honored (external waits for enter when interactive).
- **B4.** `html` preset: build one self-contained HTML (vendor `mermaid.min.js` under
  `src/conductor/assets/` or pin a CDN with offline note), write to a temp/sibling
  file, open it.
- **B5.** `mmdc-png`/`mmdc-svg`: if `mmdc` not on PATH → notice + return (Story 5
  negative: configured-but-missing binary; never hang/throw). Else render each block,
  open each output.
- **B6.** Per-block failure isolation: a block that fails to render logs a notice and
  continues with the rest (Story 3 negative). The module never throws to its caller —
  gates must not break.

### Group C — CLI subcommand [Story 3,4 direct invocation]
- **C1.** `src/engine/render-cli.ts`: `detectRenderCommand(argv)` parsing
  `render-diagrams <file|glob>...` (mirror `detectEngineerCommand`, `engineer-cli.ts:106`).
- **C2.** `src/index.ts`: dispatch `detectRenderCommand` early — non-interactive, loads
  config, runs the render module, exits (mirror registry/engineer dispatch at `:201–246`).

### Group D — Gate wiring [Stories 3,4; FR-3,4]
- **D1.** `src/ui/terminal/prompt-host.ts`: add optional
  `renderDiagrams?: (file: string, content: string) => Promise<void>` to
  `TerminalPromptHostOptions` (DI, like `readFileFn`). In `reviewArtifacts` (`:109`),
  after logging content, if it contains a ```mermaid fence, `await this.renderDiagrams?.(file, content)`
  (wrapped in try/catch — never block the gate). Covers both arch-diagram and ADR
  approval since both flow through `reviewArtifacts`.
- **D2.** `src/index.ts`: construct the host with `renderDiagrams` wired from the
  loaded `mermaid_renderer` config (host built near the `onReviewArtifacts` wiring at
  `:663`).
- **D3.** SKILL.md advisory: short "render before approval" note in
  `skills/architecture-diagram/SKILL.md` and `skills/architecture-review/SKILL.md`,
  pointing at `conduct-ts render-diagrams` for the Claude-driven presentation path.

### Group E — Install (bash) [Story 1; FR-1,6]
- **E1.** `MERMAID_RENDERER_PRESETS` table in `bin/install` beside `MD_VIEWER_PRESETS`
  (`:471`).
- **E2.** `install_mermaid_tool()` mirroring `install_md_viewer_tool()` (`:485`):
  `mmdc` via `npm install -g @mermaid-js/mermaid-cli` (guard `node` present, like
  puppeteer at `:430`); `html`/`none` need no tool (best-effort `wslu`/`wslview` on WSL).
- **E3.** `write_mermaid_renderer_config()` mirroring `write_md_viewer_config()`
  (`:546`) — Python+yaml, preserve existing keys.
- **E4.** `configure_mermaid_renderer()` mirroring `configure_md_viewer()` (`:573`):
  interactive menu, default `html`, custom option, install selected tool, persist.
  Negative path (Story 1): install fails → warn + manual hint, continue, persist anyway.
- **E5.** Call `configure_mermaid_renderer` after `configure_md_viewer` (`:868`);
  respect `--update`/non-interactive behavior.
- **E6.** `check_installation()` reports `mermaid_renderer` status (`:106` area) (FR-6).

### Group F — Tests [all stories]
- **F1.** vitest `mermaid-renderer.test.ts`: extract blocks; html build output;
  `mmdc` missing → fallback notice (no throw); `none`; per-block failure isolation.
  Inject opener (no GUI).
- **F2.** vitest `config.test.ts`: `mermaid_renderer` valid block accepted; bad
  `mode`/unknown key rejected (Story 2 negative).
- **F3.** vitest `render-cli.test.ts`: `detectRenderCommand` parses files / returns
  null for non-render argv.
- **F4.** vitest `prompt-host` test: `reviewArtifacts` calls `renderDiagrams` for a
  mermaid file, skips for a plain file, and survives a throwing callback.
- **F5.** `bin/install` covered by `test/test_harness_integrity.sh` `bash -n` sweep.

### Group G — Docs & release [FR-7]
- **G1.** `README.md`: install section — renderer choice + presets; WSL2 `html` default.
- **G2.** `src/conductor/README.md`: `render-diagrams` subcommand + `mermaid_renderer`
  config; cross-ref `md-viewer-presets.ts` parity.
- **G3.** Skill docs: render-at-approval behavior in arch-diagram / arch-review.
- **G4.** `CHANGELOG.md` → `## [Unreleased]` → **Added**. No `## Migration` block
  (additive optional config key — no schema break).
- **G5.** VERSION: stays `0.99.x`, CI auto-patches. Confirm semver call at `/finish`.

---

## Acceptance-criteria → task coverage
| Story / FR | Tasks |
|---|---|
| S1 / FR-1, FR-6 | E1–E6, F5 |
| S2 / FR-2 | A2, A3, B3, F2 |
| S3 / FR-3 | B1,B4,B5,B6, C1,C2, D1,D3, F1,F4 |
| S4 / FR-4 | B1, D1,D2,D3, F4 |
| S5 / FR-5 | B3,B5,B6, D1, F1 |
| FR-7 | G1–G3 |

## Risks / notes
- **Chromium on WSL2** is the fragile path for `mmdc-*` → mitigated by `html` default
  + graceful degrade.
- **Config validator must accept what install writes** — A3 and E3/E4 must agree on
  key names/shape; F2 guards this.
- **No GUI in tests** — opener injected; `renderDiagrams` callback mocked.
- **conduct-ts must be rebuilt** (`npm run build`) for the new subcommand/host wiring
  to reach the installed `~/.local/bin/conduct-ts`.
