import { describe, it, expect } from 'vitest';
import {
  MARKDOWN_VIEWER_PRESETS,
  PRESET_NAMES,
  VALID_MARKDOWN_VIEWER_MODES,
  getPreset,
} from '../../src/engine/md-viewer-presets.js';

describe('md-viewer-presets', () => {
  it('includes the full published preset catalog', () => {
    expect(PRESET_NAMES).toEqual(
      expect.arrayContaining([
        'glow',
        'bat',
        'mdcat',
        'cat',
        'code',
        'typora',
        'marktext',
        'nvim',
        'obsidian',
      ]),
    );
  });

  it('every preset has {file} placeholder in args', () => {
    for (const preset of MARKDOWN_VIEWER_PRESETS) {
      expect(preset.args.includes('{file}')).toBe(true);
    }
  });

  it('every preset mode is one of the valid modes', () => {
    for (const preset of MARKDOWN_VIEWER_PRESETS) {
      expect(VALID_MARKDOWN_VIEWER_MODES.has(preset.mode)).toBe(true);
    }
  });

  it('glow preset uses -p -w 80 {file} (paged + width)', () => {
    const glow = getPreset('glow');
    expect(glow).toBeDefined();
    expect(glow?.args).toEqual(['-p', '-w', '80', '{file}']);
    expect(glow?.mode).toBe('inline');
  });

  it('code preset uses --wait (blocking)', () => {
    const code = getPreset('code');
    expect(code?.mode).toBe('blocking');
    expect(code?.args.includes('--wait')).toBe(true);
  });

  it('obsidian and marktext are external mode (no blocking flag)', () => {
    expect(getPreset('obsidian')?.mode).toBe('external');
    expect(getPreset('marktext')?.mode).toBe('external');
  });

  it('getPreset returns undefined for unknown names', () => {
    expect(getPreset('nonexistent')).toBeUndefined();
  });
});
