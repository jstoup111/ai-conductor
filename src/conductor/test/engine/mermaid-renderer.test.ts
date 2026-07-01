import { describe, it, expect } from 'vitest';
import {
  extractMermaidBlocks,
  renderDiagramsForFile,
  checkDiagramsForFile,
  detectOpenerCommand,
  mmdcArgs,
  needsNoSandbox,
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

  it('ignores a mid-sentence prose mention of ```mermaid (fence must start a line)', () => {
    const prose =
      'Reads the fenced ```mermaid sources. Empty → no-op.\n\n' +
      'Later: if it contains a ```mermaid fence, render it.\n';
    expect(extractMermaidBlocks(prose)).toEqual([]);
  });

  it('matches an indented fenced block (e.g. inside a list item)', () => {
    const indented = '- item:\n  ```mermaid\n  graph TD\n    A --> B\n  ```\n';
    expect(extractMermaidBlocks(indented)).toHaveLength(1);
  });
});

describe('checkDiagramsForFile', () => {
  type CheckDeps = Pick<RenderDeps, 'hasTool' | 'runMmdc' | 'writeTemp'>;
  const baseDeps = (overrides: Partial<CheckDeps> = {}): CheckDeps => ({
    hasTool: async () => true,
    runMmdc: async () => ({ ok: true }),
    writeTemp: async (name) => `/tmp/check/${name}`,
    ...overrides,
  });

  it('returns no-diagrams when the file has no mermaid blocks', async () => {
    const r = await checkDiagramsForFile(NO_DIAGRAM_MD, baseDeps());
    expect(r.status).toBe('no-diagrams');
    expect(r.total).toBe(0);
  });

  it('returns ok when every block renders', async () => {
    const r = await checkDiagramsForFile(DIAGRAM_MD, baseDeps());
    expect(r.status).toBe('ok');
    expect(r.total).toBe(2);
    expect(r.failures).toEqual([]);
  });

  it('returns tool-missing (skip, not fail) when mmdc is absent', async () => {
    const r = await checkDiagramsForFile(DIAGRAM_MD, baseDeps({ hasTool: async () => false }));
    expect(r.status).toBe('tool-missing');
    // No blocks were run — nothing to report as a failure.
    expect(r.failures).toEqual([]);
  });

  it('reports per-block failures with the renderer error (1-based index)', async () => {
    const r = await checkDiagramsForFile(
      DIAGRAM_MD,
      baseDeps({
        runMmdc: async (input) =>
          input.includes('-2.mmd')
            ? { ok: false, error: 'Parse error on line 2: bad token' }
            : { ok: true },
      }),
    );
    expect(r.status).toBe('errors');
    expect(r.failures).toEqual([{ index: 2, error: 'Parse error on line 2: bad token' }]);
  });

  it('records a thrown writeTemp/runMmdc as that block\'s failure (never throws)', async () => {
    const r = await checkDiagramsForFile(
      DIAGRAM_MD,
      baseDeps({
        runMmdc: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(r.status).toBe('errors');
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]).toMatchObject({ index: 1, error: 'boom' });
  });
});

describe('detectOpenerCommand', () => {
  const has = (...present: string[]) => async (c: string) => present.includes(c);

  it('prefers wslview on WSL', async () => {
    expect(
      await detectOpenerCommand({ platform: 'linux', isWsl: true, hasTool: has('wslview', 'xdg-open') }),
    ).toBe('wslview');
  });

  it('falls back to explorer.exe on WSL without wslview', async () => {
    expect(
      await detectOpenerCommand({ platform: 'linux', isWsl: true, hasTool: has('explorer.exe') }),
    ).toBe('explorer.exe');
  });

  it('uses open on macOS', async () => {
    expect(await detectOpenerCommand({ platform: 'darwin', isWsl: false, hasTool: has() })).toBe('open');
  });

  it('uses xdg-open on plain Linux', async () => {
    expect(
      await detectOpenerCommand({ platform: 'linux', isWsl: false, hasTool: has('xdg-open') }),
    ).toBe('xdg-open');
  });

  it('returns null when no opener is available', async () => {
    expect(await detectOpenerCommand({ platform: 'linux', isWsl: false, hasTool: has() })).toBeNull();
  });
});

describe('needsNoSandbox', () => {
  it('is true under WSL', () => {
    expect(needsNoSandbox({ isWsl: true, uid: 1000 })).toBe(true);
  });
  it('is true for the root user (uid 0) even off WSL', () => {
    expect(needsNoSandbox({ isWsl: false, uid: 0 })).toBe(true);
  });
  it('is false for a normal user off WSL', () => {
    expect(needsNoSandbox({ isWsl: false, uid: 1000 })).toBe(false);
  });
  it('is false when uid is unknown (non-posix) off WSL', () => {
    expect(needsNoSandbox({ isWsl: false, uid: undefined })).toBe(false);
  });
});

describe('mmdcArgs', () => {
  it('builds plain -i/-o args when no puppeteer config is given', () => {
    expect(mmdcArgs('in.mmd', 'out.png')).toEqual(['-i', 'in.mmd', '-o', 'out.png']);
  });
  it('prepends -p <config> so Chromium launch flags take effect', () => {
    expect(mmdcArgs('in.mmd', 'out.png', '/cfg/puppeteer.json')).toEqual([
      '-p',
      '/cfg/puppeteer.json',
      '-i',
      'in.mmd',
      '-o',
      'out.png',
    ]);
  });
  it('treats null/empty puppeteer config as absent (no -p)', () => {
    expect(mmdcArgs('in.mmd', 'out.png', null)).toEqual(['-i', 'in.mmd', '-o', 'out.png']);
    expect(mmdcArgs('in.mmd', 'out.png', '')).toEqual(['-i', 'in.mmd', '-o', 'out.png']);
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
