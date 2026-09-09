// Covers: task:5
import { describe, expect, it } from 'vitest';
import { renderDaemonEvent } from '../src/daemon-cli.js';

function lines(event: Parameters<typeof renderDaemonEvent>[0]): string[] {
  const output: string[] = [];
  renderDaemonEvent(event, (line) => output.push(line));
  return output;
}

describe('memory setup daemon rendering', () => {
  it('names the canonical verdict and observed before state', () => {
    expect(lines({ type: 'memory_setup', before: 'absent', canonical: true }))
      .toEqual(['· memory setup canonical (before: absent)']);
  });

  it('names a non-canonical verdict without an absent reason', () => {
    expect(lines({ type: 'memory_setup', before: 'directory', canonical: false }))
      .toEqual(['· memory setup non-canonical (before: directory)']);
  });

  it('appends a non-canonical reason when supplied', () => {
    expect(lines({ type: 'memory_setup', before: 'directory', canonical: false, reason: 'disk unavailable' }))
      .toEqual(['· memory setup non-canonical (before: directory) (disk unavailable)']);
  });
});
