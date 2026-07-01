// Renders the ```mermaid blocks inside a generated `.md` artifact (architecture
// diagrams, ADRs) into something visual for the human approval gate. Dispatches
// on the configured preset NAME (html / mmdc-png / mmdc-svg / none) rather than
// the `command` field, so a tool-less preset is never confused with a missing
// binary. Best-effort by contract: it NEVER throws to its caller and NEVER fails
// open/closed in a way that blocks the gate — on any problem it returns a result
// carrying a human notice and lets the caller fall back to raw Markdown.

import { execa } from 'execa';
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import type { MermaidRendererConfig } from '../types/config.js';

export type RenderStatus =
  | 'rendered' // the renderer engaged and opened at least one diagram
  | 'no-diagrams' // file has no mermaid blocks — nothing to do
  | 'disabled' // preset 'none', unknown, or no renderer configured
  | 'tool-missing' // configured tool (mmdc) not on PATH
  | 'error'; // the renderer tried and every attempt failed

export interface RenderResult {
  status: RenderStatus;
  rendered: number;
  failed: number;
  outputs: string[];
  notice?: string;
}

export interface RenderDeps {
  /** True if the named CLI tool is resolvable on PATH. */
  hasTool: (cmd: string) => Promise<boolean>;
  /** Render one .mmd source file to an image; resolves ok:false on failure (never throws). */
  runMmdc: (inputFile: string, outputFile: string) => Promise<{ ok: boolean; error?: string }>;
  /** Open a produced artifact with the platform opener (browser/image viewer). */
  open: (path: string) => Promise<void>;
  /** Write transient render input/output; returns the absolute path written. */
  writeTemp: (name: string, content: string) => Promise<string>;
  /** Emit a human-facing line (notices, per-block failures). */
  log: (msg: string) => void;
}

/** Pick the command that opens a produced artifact in the OS default app,
 *  resolved per platform (macOS `open`, Linux `xdg-open`, WSL `wslview`/
 *  `explorer.exe`). Returns null when nothing suitable is found — the caller
 *  then prints the path. */
export async function detectOpenerCommand(opts: {
  platform: NodeJS.Platform;
  isWsl: boolean;
  hasTool: (cmd: string) => Promise<boolean>;
}): Promise<string | null> {
  const { platform, isWsl, hasTool } = opts;
  if (isWsl) {
    // Prefer opening on the Windows side so it lands in a real GUI app.
    if (await hasTool('wslview')) return 'wslview';
    if (await hasTool('explorer.exe')) return 'explorer.exe';
    if (await hasTool('xdg-open')) return 'xdg-open';
    return null;
  }
  if (platform === 'darwin') return 'open';
  if (await hasTool('xdg-open')) return 'xdg-open';
  return null;
}

/**
 * Pull the source of every ```mermaid fenced block, in document order. The
 * opening and closing fences must START a line (optionally indented) — so a
 * prose mention like "the fenced ```mermaid sources" mid-sentence is NOT
 * treated as a block opener (which would feed prose to the renderer and report
 * a spurious "UnknownDiagramError").
 */
export function extractMermaidBlocks(content: string): string[] {
  const re = /^[^\S\n]*```mermaid[^\n]*\n([\s\S]*?)^[^\S\n]*```/gm;
  const blocks: string[] = [];
  for (const m of content.matchAll(re)) {
    blocks.push(m[1].replace(/\s+$/, ''));
  }
  return blocks;
}

/** Filesystem-safe stem from a source path: "a/b/containers.md" -> "containers". */
function stem(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'diagram';
}

/** Escape the HTML-significant characters so a diagram label can't break out of
 *  its <pre> element (corrupting the render) or inject markup. Mermaid decodes
 *  these entities itself when it reads the element's text. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(title: string, blocks: string[]): string {
  // Self-contained preview: Mermaid renders the blocks client-side. The script
  // is loaded from a pinned CDN, so the browser opening this page needs network
  // access. Block source is HTML-escaped before embedding; Mermaid decodes the
  // entities back when it reads each node's text content.
  const sections = blocks
    .map((b) => `<pre class="mermaid">\n${escapeHtml(b)}\n</pre>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #fff; }
  h1 { font-size: 1.25rem; color: #333; }
  pre.mermaid { background: #fafafa; padding: 1rem; border-radius: 6px; overflow: auto; }
</style>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
</head>
<body>
<h1>${title}</h1>
${sections}
</body>
</html>
`;
}

export async function renderDiagramsForFile(
  file: string,
  content: string,
  config: MermaidRendererConfig | undefined,
  deps: RenderDeps,
): Promise<RenderResult> {
  const empty: RenderResult = { status: 'no-diagrams', rendered: 0, failed: 0, outputs: [] };
  // Logging must never be able to break the never-throw contract.
  const safeLog = (msg: string) => {
    try {
      deps.log(msg);
    } catch {
      /* a broken logger must not propagate to the approval gate */
    }
  };
  try {
    const blocks = extractMermaidBlocks(content);
    if (blocks.length === 0) return empty;

    const preset = config?.preset;
    if (!config || !preset || preset === 'none') {
      return {
        status: 'disabled',
        rendered: 0,
        failed: 0,
        outputs: [],
        notice: 'diagram rendering disabled — showing raw Markdown (configure mermaid_renderer to enable)',
      };
    }

    if (preset === 'html') {
      const out = await deps.writeTemp(`${stem(file)}.html`, buildHtml(stem(file), blocks));
      await deps.open(out);
      return { status: 'rendered', rendered: 1, failed: 0, outputs: [out] };
    }

    if (preset === 'mmdc-png' || preset === 'mmdc-svg') {
      if (!(await deps.hasTool('mmdc'))) {
        return {
          status: 'tool-missing',
          rendered: 0,
          failed: 0,
          outputs: [],
          notice:
            "mermaid renderer 'mmdc' not found — showing raw Markdown (install @mermaid-js/mermaid-cli, or set mermaid_renderer.preset: html)",
        };
      }
      const ext = preset === 'mmdc-svg' ? 'svg' : 'png';
      let rendered = 0;
      let failed = 0;
      const outputs: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        // Each diagram is isolated: a writeTemp/runMmdc/open failure on one
        // block must not lose the others (or the already-rendered outputs).
        try {
          const inPath = await deps.writeTemp(`${stem(file)}-${i + 1}.mmd`, blocks[i]);
          const outPath = `${inPath.replace(/\.mmd$/, '')}.${ext}`;
          const res = await deps.runMmdc(inPath, outPath);
          if (!res.ok) throw new Error(res.error ?? 'render failed');
          await deps.open(outPath);
          outputs.push(outPath);
          rendered += 1;
        } catch (e) {
          failed += 1;
          safeLog(`  ⚠ could not render diagram ${i + 1} of ${stem(file)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const total = blocks.length;
      if (rendered === 0 && failed > 0) {
        return {
          status: 'error',
          rendered,
          failed,
          outputs,
          notice: `all ${total} diagram(s) failed to render — showing raw Markdown`,
        };
      }
      return {
        status: 'rendered',
        rendered,
        failed,
        outputs,
        notice: failed > 0 ? `${failed} of ${total} diagram(s) failed to render — showing raw Markdown for those` : undefined,
      };
    }

    // Unknown preset name — treat as disabled rather than guessing.
    return {
      status: 'disabled',
      rendered: 0,
      failed: 0,
      outputs: [],
      notice: `unknown mermaid_renderer preset '${preset}' — showing raw Markdown`,
    };
  } catch (err) {
    // Contract: never throw to the caller. Degrade to raw Markdown with a notice.
    safeLog(`  ⚠ diagram rendering failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: 'error', rendered: 0, failed: 0, outputs: [], notice: 'diagram rendering error — showing raw Markdown' };
  }
}

// --- Validation (authoring-time syntax check) --------------------------------

export type DiagramCheckStatus =
  | 'ok' // every mermaid block parsed/rendered
  | 'no-diagrams' // no mermaid blocks in the file
  | 'tool-missing' // mmdc not on PATH — cannot validate here (SKIP, not fail)
  | 'errors'; // at least one block failed to parse/render

export interface DiagramCheckResult {
  status: DiagramCheckStatus;
  total: number;
  /** 1-based block index + the renderer's error (mmdc stderr carries the parse line). */
  failures: { index: number; error: string }[];
}

/**
 * Parse-check every ```mermaid block in a file by actually rendering it with
 * mmdc (to a throwaway output that is NOT opened). Unlike renderDiagramsForFile
 * — whose contract is "never block the approval gate, degrade to raw Markdown"
 * — this DISTINGUISHES an author error (a block that won't parse → `errors`,
 * the caller should fail) from an environment limitation (`tool-missing` →
 * the caller should SKIP, since a CI box without Chromium can't validate).
 *
 * Never throws: a thrown writeTemp/runMmdc is recorded as that block's failure.
 */
export async function checkDiagramsForFile(
  content: string,
  deps: Pick<RenderDeps, 'hasTool' | 'runMmdc' | 'writeTemp'>,
  stemName = 'diagram',
): Promise<DiagramCheckResult> {
  const blocks = extractMermaidBlocks(content);
  if (blocks.length === 0) return { status: 'no-diagrams', total: 0, failures: [] };
  if (!(await deps.hasTool('mmdc'))) {
    return { status: 'tool-missing', total: blocks.length, failures: [] };
  }

  const failures: { index: number; error: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    try {
      const inPath = await deps.writeTemp(`check-${stemName}-${i + 1}.mmd`, blocks[i]);
      const outPath = `${inPath.replace(/\.mmd$/, '')}.svg`;
      const res = await deps.runMmdc(inPath, outPath);
      if (!res.ok) failures.push({ index: i + 1, error: res.error ?? 'render failed' });
    } catch (e) {
      failures.push({ index: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    status: failures.length > 0 ? 'errors' : 'ok',
    total: blocks.length,
    failures,
  };
}

// --- Production wiring -------------------------------------------------------

function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/** Default path for an operator-managed puppeteer config (the escape hatch a
 *  human can hand-write to fully control Chromium launch). */
export const USER_PUPPETEER_CONFIG = join(homedir(), '.ai-conductor', 'puppeteer.json');

/**
 * Whether Chromium's setuid sandbox is unavailable, so mmdc must launch with
 * `--no-sandbox`. True under WSL and for the root user (root cannot use the
 * setuid sandbox). This is NOT a WSL-specific carve-out — it is the general
 * "sandbox can't initialize here" predicate; containers/CI that run as root are
 * covered too. Pure: all environment facts are injected.
 */
export function needsNoSandbox(env: { isWsl: boolean; uid: number | undefined }): boolean {
  return env.isWsl || env.uid === 0;
}

/**
 * Build the mmdc argument vector. When a puppeteer config path is provided it is
 * passed via `-p` so its Chromium launch flags (e.g. `--no-sandbox`) and any
 * explicit `executablePath` take effect; otherwise mmdc launches with defaults.
 * Pure and order-stable for testing.
 */
export function mmdcArgs(
  inputFile: string,
  outputFile: string,
  puppeteerConfigPath?: string | null,
): string[] {
  const args: string[] = [];
  if (puppeteerConfigPath) args.push('-p', puppeteerConfigPath);
  args.push('-i', inputFile, '-o', outputFile);
  return args;
}

/** Real RenderDeps backed by execa + the OS temp dir. The opener is resolved
 *  once and cached. `log` is injected so callers control where notices go. */
export function defaultRenderDeps(log: (msg: string) => void): RenderDeps {
  // `cmd` MUST be a trusted literal — it is interpolated into `sh -c`. All
  // callers here pass hardcoded tool names ('mmdc'/'wslview'/'explorer.exe'/
  // 'xdg-open'); never pass user- or file-derived input.
  const hasTool = async (cmd: string): Promise<boolean> => {
    try {
      const r = await execa('sh', ['-c', `command -v ${cmd}`], { reject: false });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  };

  let openerCache: string | null | undefined;
  const resolveOpener = async (): Promise<string | null> => {
    if (openerCache === undefined) {
      openerCache = await detectOpenerCommand({ platform: process.platform, isWsl: isWsl(), hasTool });
    }
    return openerCache;
  };

  // First Chromium-family binary resolvable on PATH, as an absolute path, or null.
  const resolveChromePath = async (): Promise<string | null> => {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']) {
      const r = await execa('sh', ['-c', `command -v ${bin}`], { reject: false });
      if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  };

  // Resolve (once) the puppeteer config mmdc should use. Order of precedence:
  //   1. an operator-managed ~/.ai-conductor/puppeteer.json (full control), else
  //   2. in sandbox-hostile environments (WSL / root / containers) a transient
  //      config enabling --no-sandbox, plus an explicit Chrome executablePath
  //      when one is found (covers a missing bundled Chromium), else
  //   3. null — the default sandboxed launch is fine.
  // Without this, `mmdc` fails to launch Chromium on WSL/containers and every
  // diagram silently falls back to raw Markdown.
  let puppeteerCfgCache: string | null | undefined;
  const resolvePuppeteerConfig = async (): Promise<string | null> => {
    if (puppeteerCfgCache !== undefined) return puppeteerCfgCache;
    if (existsSync(USER_PUPPETEER_CONFIG)) {
      puppeteerCfgCache = USER_PUPPETEER_CONFIG;
      return puppeteerCfgCache;
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (!needsNoSandbox({ isWsl: isWsl(), uid })) {
      puppeteerCfgCache = null;
      return puppeteerCfgCache;
    }
    const cfg: Record<string, unknown> = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    const chrome = await resolveChromePath();
    if (chrome) cfg.executablePath = chrome;
    const dir = join(tmpdir(), 'conduct-mermaid');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'puppeteer.json');
    await writeFile(path, JSON.stringify(cfg), 'utf-8');
    puppeteerCfgCache = path;
    return puppeteerCfgCache;
  };

  return {
    hasTool,
    runMmdc: async (inputFile, outputFile) => {
      try {
        const puppeteerCfg = await resolvePuppeteerConfig();
        const r = await execa('mmdc', mmdcArgs(inputFile, outputFile, puppeteerCfg), { reject: false });
        return { ok: r.exitCode === 0, error: r.exitCode === 0 ? undefined : r.stderr || 'mmdc failed' };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    open: async (path) => {
      const opener = await resolveOpener();
      if (!opener) {
        log(`  diagram written to ${path} (no opener found — open it manually)`);
        return;
      }
      // The known openers fork-and-return promptly; the bounded timeout keeps
      // the never-block contract resting on code, not on opener behavior.
      await execa(opener, [path], { reject: false, timeout: 10_000, stdio: 'ignore' });
    },
    writeTemp: async (name, content) => {
      const dir = join(tmpdir(), 'conduct-mermaid');
      await mkdir(dir, { recursive: true });
      const path = join(dir, name);
      await writeFile(path, content, 'utf-8');
      return path;
    },
    log,
  };
}
