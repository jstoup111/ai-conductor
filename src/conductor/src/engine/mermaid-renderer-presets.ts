// Mermaid renderer preset catalog — single source of truth for the `bin/install`
// prompt and the conduct-ts artifact-review render path. Parallels
// `md-viewer-presets.ts`; keep the two in sync if you add/remove presets.
//
// Render presets turn the Mermaid blocks inside a generated `.md` (architecture
// diagrams, ADRs) into something visual for the human approval gate. `html` is
// the default: it needs no native dependencies and opens in the OS default
// browser on any platform, so it is the lowest-friction option everywhere. The
// `mmdc-*` presets shell out to `@mermaid-js/mermaid-cli` and need Chromium.

export type MermaidRendererMode = 'inline' | 'blocking' | 'external';

export interface MermaidRendererPreset {
  name: string;
  command: string;
  args: string[];
  mode: MermaidRendererMode;
  label: string;
  notes: string;
}

export const MERMAID_RENDERER_PRESETS: readonly MermaidRendererPreset[] = [
  {
    name: 'html',
    command: '',
    args: ['{file}'],
    mode: 'external',
    label: 'HTML preview (browser)',
    notes: 'Self-contained HTML rendered with mermaid.js, opened in the default browser. No native dependencies — works on any platform.',
  },
  {
    name: 'mmdc-png',
    command: 'mmdc',
    args: ['-i', '{file}', '-o', '{out}'],
    mode: 'external',
    label: 'PNG images (mermaid-cli)',
    notes: 'Renders each diagram to PNG via @mermaid-js/mermaid-cli (needs Chromium).',
  },
  {
    name: 'mmdc-svg',
    command: 'mmdc',
    args: ['-i', '{file}', '-o', '{out}'],
    mode: 'external',
    label: 'SVG images (mermaid-cli)',
    notes: 'Renders each diagram to SVG via @mermaid-js/mermaid-cli (needs Chromium).',
  },
  {
    name: 'none',
    command: '',
    args: ['{file}'],
    mode: 'external',
    label: 'disabled (raw Markdown)',
    notes: 'No rendering — diagrams are reviewed as raw Markdown.',
  },
];

export function getMermaidPreset(name: string): MermaidRendererPreset | undefined {
  return MERMAID_RENDERER_PRESETS.find((p) => p.name === name);
}

export const MERMAID_PRESET_NAMES = MERMAID_RENDERER_PRESETS.map((p) => p.name);

export const VALID_MERMAID_RENDERER_MODES: ReadonlySet<MermaidRendererMode> =
  new Set<MermaidRendererMode>(['inline', 'blocking', 'external']);
