import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Checkpoint } from '../../../src/ui/terminal/checkpoint.js';

describe('Checkpoint', () => {
  it('renders c/b/q options with labels', () => {
    const onChoice = vi.fn();
    const { lastFrame } = render(
      <Checkpoint stepName="stories" onChoice={onChoice} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('c');
    expect(frame).toContain('continue');
    expect(frame).toContain('b');
    expect(frame).toContain('go back');
    expect(frame).toContain('q');
    expect(frame).toContain('quit');
  });

  it('shows step name in prompt', () => {
    const onChoice = vi.fn();
    const { lastFrame } = render(
      <Checkpoint stepName="build" onChoice={onChoice} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('build');
  });
});
