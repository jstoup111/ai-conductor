import { describe, it, expect } from 'vitest';
import { parsePriorityLabels } from '../src/engine/backlog-priority.js';

describe('parsePriorityLabels — extract priority from issue labels', () => {
  it('single high priority label returns high', () => {
    expect(parsePriorityLabels(['priority: high'])).toBe('high');
  });

  it('single medium priority label returns medium', () => {
    expect(parsePriorityLabels(['priority: medium'])).toBe('medium');
  });

  it('single low priority label returns low', () => {
    expect(parsePriorityLabels(['priority: low'])).toBe('low');
  });

  it('multiple priority labels returns highest (high > medium)', () => {
    expect(parsePriorityLabels(['priority: low', 'priority: high'])).toBe('high');
  });

  it('mixed labels with priority extracted correctly', () => {
    expect(parsePriorityLabels(['bug', 'intake', 'priority: medium'])).toBe('medium');
  });

  it('all three priority levels present returns highest', () => {
    expect(parsePriorityLabels(['priority: low', 'priority: medium', 'priority: high'])).toBe('high');
  });
});
