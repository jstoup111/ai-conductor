// `conduct render-diagrams <file>...` — render the Mermaid blocks in one or more
// generated `.md` artifacts using the configured `mermaid_renderer` preset.
// Runs non-interactively and exits, mirroring the engineer/registry subcommand
// pattern. Best-effort: a render failure never makes the command fail hard.

import { readFile } from 'node:fs/promises';
import { loadMergedConfig } from './config.js';
import { renderDiagramsForFile, defaultRenderDeps } from './mermaid-renderer.js';

export type RenderDispatch =
  | { kind: 'render'; files: string[] }
  | { kind: 'guide' };

/**
 * Parse argv for the `render-diagrams` subcommand.
 *   conduct render-diagrams a.md b.md   → {kind:'render', files:['a.md','b.md']}
 *   conduct render-diagrams             → {kind:'guide'}  (no files)
 *   (any other sub)                     → null
 * Flags (leading '-') are ignored when collecting files.
 */
export function detectRenderCommand(argv: string[]): RenderDispatch | null {
  const sub = argv[2];
  if (sub !== 'render-diagrams') return null;
  const files = argv.slice(3).filter((a) => a && !a.startsWith('-'));
  if (files.length === 0) return { kind: 'guide' };
  return { kind: 'render', files };
}

export async function dispatchRender(cmd: RenderDispatch, projectRoot: string): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct render-diagrams <file.md>...\n' +
        '  Renders the Mermaid diagrams in the given Markdown file(s) using your\n' +
        '  configured mermaid_renderer preset (see ~/.ai-conductor/config.yml).',
    );
    return 1;
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
