import { describe, it, expect } from 'vitest';
import { detectRenderCommand } from '../../src/engine/render-cli.js';

const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

describe('detectRenderCommand', () => {
  it('returns null for a non-render subcommand', () => {
    expect(detectRenderCommand(argv('inline', 'feature'))).toBeNull();
    expect(detectRenderCommand(argv('daemon'))).toBeNull();
  });

  it('collects file arguments', () => {
    expect(detectRenderCommand(argv('render-diagrams', 'a.md', 'b.md'))).toEqual({
      kind: 'render',
      files: ['a.md', 'b.md'],
    });
  });

  it('returns guide when no files are given', () => {
    expect(detectRenderCommand(argv('render-diagrams'))).toEqual({ kind: 'guide' });
  });

  it('ignores flags when collecting files', () => {
    expect(detectRenderCommand(argv('render-diagrams', '--verbose', 'a.md'))).toEqual({
      kind: 'render',
      files: ['a.md'],
    });
  });
});
