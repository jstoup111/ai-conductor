import { describe, it, expect } from 'vitest';
import {
  extractMermaidBlocks,
  renderDiagramsForFile,
  type RenderDeps,
} from '../../src/engine/mermaid-renderer.js';
import type { MermaidRendererConfig } from '../../src/types/config.js';

const DIAGRAM_MD = [
  '# Containers',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  'some prose',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  A->>B: hi',
  '```',
  '',
].join('\n');

const NO_DIAGRAM_MD = '# ADR 1\n\nJust text, a `code span`, and a ```bash\nls\n``` block.\n';

function makeDeps(overrides: Partial<RenderDeps> = {}): {
  deps: RenderDeps;
  opened: string[];
  logs: string[];
} {
  const opened: string[] = [];
  const logs: string[] = [];
  const deps: RenderDeps = {
    hasTool: async () => true,
    runMmdc: async (_in, out) => {
      void out;
      return { ok: true };
    },
    open: async (p) => {
      opened.push(p);
    },
    writeTemp: async (name) => `/tmp/render-test/${name}`,
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { deps, opened, logs };
}

const html: MermaidRendererConfig = { preset: 'html', command: '', args: ['{file}'], mode: 'external' };
const mmdcPng: MermaidRendererConfig = {
  preset: 'mmdc-png',
  command: 'mmdc',
  args: ['-i', '{file}', '-o', '{out}'],
  mode: 'external',
};
const none: MermaidRendererConfig = { preset: 'none', command: '', args: ['{file}'], mode: 'external' };

describe('extractMermaidBlocks', () => {
  it('returns one entry per mermaid fence', () => {
    expect(extractMermaidBlocks(DIAGRAM_MD)).toHaveLength(2);
  });

  it('returns empty for content with no mermaid fence', () => {
    expect(extractMermaidBlocks(NO_DIAGRAM_MD)).toEqual([]);
  });
});

describe('renderDiagramsForFile', () => {
  it('skips with no-diagrams and never opens when the file has no mermaid (Story 4)', async () => {
    const { deps, opened } = makeDeps();
    const result = await renderDiagramsForFile('adr.md', NO_DIAGRAM_MD, html, deps);
    expect(result.status).toBe('no-diagrams');
    expect(opened).toHaveLength(0);
  });

  it('skips with disabled when preset is none (Story 5 happy)', async () => {
    const { deps, opened } = makeDeps();
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, none, deps);
    expect(result.status).toBe('disabled');
    expect(opened).toHaveLength(0);
    expect(result.notice).toBeTruthy();
  });

  it('skips with disabled when no renderer is configured (Story 5 happy)', async () => {
    const { deps } = makeDeps();
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, undefined, deps);
    expect(result.status).toBe('disabled');
  });

  it('html preset builds one self-contained HTML embedding mermaid + script and opens it (Story 3)', async () => {
    let writtenContent = '';
    const { deps, opened } = makeDeps({
      writeTemp: async (name, content) => {
        writtenContent = content;
        return `/tmp/render-test/${name}`;
      },
    });
    const result = await renderDiagramsForFile('containers.md', DIAGRAM_MD, html, deps);
    expect(result.status).toBe('rendered');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/\.html$/);
    expect(writtenContent).toMatch(/mermaid/i);
    expect(writtenContent).toContain('graph TD');
  });

  it('mmdc preset with tool missing returns tool-missing, a notice, and never throws (Story 5 negative)', async () => {
    const { deps, opened } = makeDeps({ hasTool: async () => false });
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, mmdcPng, deps);
    expect(result.status).toBe('tool-missing');
    expect(result.notice).toBeTruthy();
    expect(opened).toHaveLength(0);
  });

  it('mmdc preset isolates a per-block render failure and still opens the good ones (Story 3 negative)', async () => {
    let call = 0;
    const { deps, opened } = makeDeps({
      runMmdc: async () => {
        call += 1;
        return call === 1 ? { ok: false, error: 'parse error' } : { ok: true };
      },
    });
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, mmdcPng, deps);
    expect(result.rendered).toBe(1);
    expect(result.failed).toBe(1);
    expect(opened).toHaveLength(1);
    expect(result.status).toBe('rendered');
    expect(result.notice).toBeTruthy(); // partial failure must surface a notice
  });

  it('isolates a rejecting open() and still renders the remaining diagrams (Story 3 negative)', async () => {
    let openCall = 0;
    const opened: string[] = [];
    const { deps } = makeDeps({
      open: async (p) => {
        openCall += 1;
        if (openCall === 1) throw new Error('opener crashed');
        opened.push(p);
      },
    });
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, mmdcPng, deps);
    expect(result.rendered).toBe(1);
    expect(result.failed).toBe(1);
    expect(opened).toHaveLength(1);
  });

  it('reports error (not rendered) with a notice when every diagram fails (Story 5 negative)', async () => {
    const { deps, opened } = makeDeps({ runMmdc: async () => ({ ok: false, error: 'bad' }) });
    const result = await renderDiagramsForFile('c.md', DIAGRAM_MD, mmdcPng, deps);
    expect(result.rendered).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.status).toBe('error');
    expect(result.notice).toBeTruthy();
    expect(opened).toHaveLength(0);
  });

  it('escapes HTML-special characters in diagram source (injection/corruption guard)', async () => {
    let written = '';
    const { deps } = makeDeps({
      writeTemp: async (name, content) => {
        written = content;
        return `/tmp/render-test/${name}`;
      },
    });
    const evil = '# C\n\n```mermaid\ngraph TD\n  A["</pre><script>alert(1)</script>"] --> B\n```\n';
    await renderDiagramsForFile('c.md', evil, html, deps);
    expect(written).not.toContain('<script>alert(1)</script>');
    expect(written).toContain('&lt;/pre&gt;');
  });

  it('never throws even if log() throws inside the failure path (Story 5)', async () => {
    const { deps } = makeDeps({
      open: async () => {
        throw new Error('open boom');
      },
      log: () => {
        throw new Error('log boom');
      },
    });
    await expect(renderDiagramsForFile('c.md', DIAGRAM_MD, html, deps)).resolves.toBeTruthy();
  });
});
