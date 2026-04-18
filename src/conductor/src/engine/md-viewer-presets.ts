// Markdown viewer preset catalog — single source of truth for `bin/install`
// prompt, bash `render_md`, and the conduct-ts artifact-review path.

export type MarkdownViewerMode = 'inline' | 'blocking' | 'external';

export interface MarkdownViewerPreset {
  name: string;
  command: string;
  args: string[];
  mode: MarkdownViewerMode;
  label: string;
  notes: string;
}

export const MARKDOWN_VIEWER_PRESETS: readonly MarkdownViewerPreset[] = [
  {
    name: 'glow',
    command: 'glow',
    args: ['-p', '-w', '80', '{file}'],
    mode: 'inline',
    label: 'glow',
    notes: 'Terminal, paged, ANSI styled',
  },
  {
    name: 'bat',
    command: 'bat',
    args: ['--style=plain', '--paging=never', '{file}'],
    mode: 'inline',
    label: 'bat',
    notes: 'Terminal, syntax-highlighted',
  },
  {
    name: 'mdcat',
    command: 'mdcat',
    args: ['{file}'],
    mode: 'inline',
    label: 'mdcat',
    notes: 'Terminal, Sixel image support',
  },
  {
    name: 'cat',
    command: 'cat',
    args: ['{file}'],
    mode: 'inline',
    label: 'cat',
    notes: 'Universal fallback',
  },
  {
    name: 'code',
    command: 'code',
    args: ['--wait', '{file}'],
    mode: 'blocking',
    label: 'VSCode',
    notes: 'GUI editor, waits until file is closed',
  },
  {
    name: 'typora',
    command: 'typora',
    args: ['--wait', '{file}'],
    mode: 'blocking',
    label: 'Typora',
    notes: 'GUI editor (Typora ≥1.3 supports --wait)',
  },
  {
    name: 'marktext',
    command: 'marktext',
    args: ['{file}'],
    mode: 'external',
    label: 'MarkText',
    notes: 'GUI editor — press-enter to continue',
  },
  {
    name: 'nvim',
    command: 'nvim',
    args: ['{file}'],
    mode: 'blocking',
    label: 'neovim',
    notes: 'Terminal editor, headless-friendly',
  },
  {
    name: 'obsidian',
    command: 'obsidian',
    args: ['{file}'],
    mode: 'external',
    label: 'Obsidian',
    notes: 'GUI — press-enter to continue',
  },
];

export function getPreset(name: string): MarkdownViewerPreset | undefined {
  return MARKDOWN_VIEWER_PRESETS.find((p) => p.name === name);
}

export const PRESET_NAMES = MARKDOWN_VIEWER_PRESETS.map((p) => p.name);

export const VALID_MARKDOWN_VIEWER_MODES: ReadonlySet<MarkdownViewerMode> = new Set<MarkdownViewerMode>([
  'inline',
  'blocking',
  'external',
]);
