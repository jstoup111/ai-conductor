// `conduct render-diagrams <file>...` — render the Mermaid blocks in one or more
// generated `.md` artifacts using the configured `mermaid_renderer` preset.
// Runs non-interactively and exits, mirroring the engineer/registry subcommand
// pattern. Best-effort: a render failure never makes the command fail hard.

import { readFile } from 'node:fs/promises';
import { loadMergedConfig } from './config.js';
import {
  renderDiagramsForFile,
  checkDiagramsForFile,
  defaultRenderDeps,
} from './mermaid-renderer.js';

export type RenderDispatch =
  | { kind: 'render'; files: string[] }
  | { kind: 'check'; files: string[] }
  | { kind: 'guide' };

/** Filesystem-safe stem from a path: "a/b/containers.md" -> "containers". */
function stemOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'diagram';
}

/**
 * Parse argv for the `render-diagrams` subcommand.
 *   conduct render-diagrams a.md b.md          → {kind:'render', files:[...]}
 *   conduct render-diagrams --check a.md b.md   → {kind:'check', files:[...]}
 *   conduct render-diagrams [--check]           → {kind:'guide'}  (no files)
 *   (any other sub)                             → null
 * Flags (leading '-') are ignored when collecting files.
 */
export function detectRenderCommand(argv: string[]): RenderDispatch | null {
  const sub = argv[2];
  if (sub !== 'render-diagrams') return null;
  const rest = argv.slice(3);
  const check = rest.includes('--check');
  const files = rest.filter((a) => a && !a.startsWith('-'));
  if (files.length === 0) return { kind: 'guide' };
  return { kind: check ? 'check' : 'render', files };
}

export async function dispatchRender(cmd: RenderDispatch, projectRoot: string): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct render-diagrams <file.md>...\n' +
        '  Renders the Mermaid diagrams in the given Markdown file(s) using your\n' +
        '  configured mermaid_renderer preset (see ~/.ai-conductor/config.yml).\n' +
        'conduct render-diagrams --check <file.md>...\n' +
        '  Parse-checks every Mermaid block (does NOT open them) and exits non-zero\n' +
        '  if any block fails to render. Skips with exit 0 when mmdc is unavailable.',
    );
    return 1;
  }

  if (cmd.kind === 'check') {
    return dispatchCheck(cmd.files);
  }

  const configResult = await loadMergedConfig(projectRoot);
  const config = configResult.ok ? configResult.config.mermaid_renderer : undefined;
  const deps = defaultRenderDeps((m) => console.error(m));

  for (const file of cmd.files) {
    try {
      const content = await readFile(file, 'utf-8');
      const result = await renderDiagramsForFile(file, content, config, deps);
      if (result.notice) console.error(`  ${file}: ${result.notice}`);
    } catch (e) {
      console.error(`  ${file}: could not read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return 0;
}

/**
 * `--check` mode: parse-check the Mermaid blocks in each file. Exit 1 if any
 * block in any file is a syntax error (the author must fix it); exit 0 when
 * everything parses, there are no diagrams, or mmdc is unavailable (an
 * environment without Chromium can't validate — skip rather than false-fail).
 */
async function dispatchCheck(files: string[]): Promise<number> {
  // mmdc validates via the same puppeteer-config resolution renderDiagramsForFile
  // uses (no-sandbox on WSL/root), so a check passes wherever a render would.
  const deps = defaultRenderDeps((m) => console.error(m));
  let toolMissing = false;
  let hadErrors = false;

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch (e) {
      console.error(`  ✗ ${file}: could not read (${e instanceof Error ? e.message : String(e)})`);
      hadErrors = true;
      continue;
    }
    const result = await checkDiagramsForFile(content, deps, stemOf(file));
    switch (result.status) {
      case 'no-diagrams':
        break;
      case 'ok':
        console.error(`  ✓ ${file}: ${result.total} diagram(s) render`);
        break;
      case 'tool-missing':
        toolMissing = true;
        break;
      case 'errors':
        hadErrors = true;
        for (const f of result.failures) {
          const firstLine = f.error.split('\n').find((l) => /error/i.test(l)) ?? f.error.split('\n')[0];
          console.error(`  ✗ ${file}: diagram ${f.index} failed — ${firstLine.trim()}`);
        }
        break;
    }
  }

  if (hadErrors) return 1;
  if (toolMissing) {
    console.error(
      '  ⚠ mmdc not found — skipped diagram syntax check (install @mermaid-js/mermaid-cli to validate).',
    );
  }
  return 0;
}
