import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Recovery } from '../../../src/ui/terminal/recovery.js';
import type { RecoveryOption } from '../../../src/types/index.js';

describe('Recovery', () => {
  it('renders all 5 options for non-gating step', () => {
    const options: RecoveryOption[] = ['retry', 'interactive', 'back', 'skip', 'quit'];
    const onChoice = vi.fn();
    const { lastFrame } = render(
      <Recovery stepName="build" options={options} onChoice={onChoice} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('r');
    expect(frame).toContain('retry');
    expect(frame).toContain('i');
    expect(frame).toContain('interactive fix');
    expect(frame).toContain('b');
    expect(frame).toContain('go back');
    expect(frame).toContain('s');
    expect(frame).toContain('skip');
    expect(frame).toContain('q');
    expect(frame).toContain('quit');
  });

  it('renders 4 options (no skip) for gating step', () => {
    const options: RecoveryOption[] = ['retry', 'interactive', 'back', 'quit'];
    const onChoice = vi.fn();
    const { lastFrame } = render(
      <Recovery stepName="stories" options={options} onChoice={onChoice} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('retry');
    expect(frame).toContain('interactive fix');
    expect(frame).toContain('go back');
    expect(frame).toContain('quit');
    expect(frame).not.toContain('skip');
  });

  it('shows step name and failure context', () => {
    const options: RecoveryOption[] = ['retry', 'quit'];
    const onChoice = vi.fn();
    const { lastFrame } = render(
      <Recovery stepName="acceptance_specs" options={options} onChoice={onChoice} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('acceptance_specs');
    expect(frame).toContain('Recovery');
  });
});
