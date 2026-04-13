import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Navigation, type NavigationStep } from '../../../src/ui/terminal/navigation.js';

const SAMPLE_STEPS: NavigationStep[] = [
  { name: 'worktree', label: 'Worktree', status: 'done', phase: 'SETUP' },
  { name: 'memory', label: 'Memory', status: 'done', phase: 'SETUP' },
  { name: 'brainstorm', label: 'Brainstorm', status: 'in_progress', phase: 'UNDERSTAND' },
  { name: 'stories', label: 'Stories', status: 'pending', phase: 'UNDERSTAND' },
];

describe('Navigation', () => {
  it('renders numbered list of steps', () => {
    const onSelect = vi.fn();
    const { lastFrame } = render(
      <Navigation steps={SAMPLE_STEPS} onSelect={onSelect} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('1');
    expect(frame).toContain('2');
    expect(frame).toContain('3');
    expect(frame).toContain('4');
  });

  it('shows step label, state, phase', () => {
    const onSelect = vi.fn();
    const { lastFrame } = render(
      <Navigation steps={SAMPLE_STEPS} onSelect={onSelect} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Worktree');
    expect(frame).toContain('[done]');
    expect(frame).toContain('[SETUP]');
    expect(frame).toContain('Brainstorm');
    expect(frame).toContain('[in_progress]');
    expect(frame).toContain('[UNDERSTAND]');
  });

  it('includes cancel option (0)', () => {
    const onSelect = vi.fn();
    const { lastFrame } = render(
      <Navigation steps={SAMPLE_STEPS} onSelect={onSelect} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('0');
    expect(frame).toContain('Cancel');
  });
});
