import { describe, it, expect } from 'vitest';
import { detectTaskCommand } from '../../src/engine/task-cli.js';

describe('detectTaskCommand', () => {
  describe('start command', () => {
    it('detects: conduct task start <id>', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '7'])).toEqual({
        kind: 'start',
        id: '7',
      });
    });

    it('detects: conduct task start with alphanumeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', 'rem-fr10-1'])).toEqual({
        kind: 'start',
        id: 'rem-fr10-1',
      });
    });

    it('detects: conduct task start with numeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', '42'])).toEqual({
        kind: 'start',
        id: '42',
      });
    });
  });

  describe('done command', () => {
    it('detects: conduct task done <id>', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', '7'])).toEqual({
        kind: 'done',
        id: '7',
      });
    });

    it('detects: conduct task done with alphanumeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', 'rem-fr10-1'])).toEqual({
        kind: 'done',
        id: 'rem-fr10-1',
      });
    });

    it('detects: conduct task done with numeric id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done', '42'])).toEqual({
        kind: 'done',
        id: '42',
      });
    });
  });

  describe('guide / malformed', () => {
    it('returns guide for bare "task" (no verb)', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for unknown verb', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'invalid', '7'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for missing id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for missing id with done verb', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'done'])).toEqual({
        kind: 'guide',
      });
    });

    it('returns guide for malformed: empty id', () => {
      expect(detectTaskCommand(['node', 'conduct', 'task', 'start', ''])).toEqual({
        kind: 'guide',
      });
    });
  });

  describe('non-task commands', () => {
    it('returns null for non-task subcommand', () => {
      expect(detectTaskCommand(['node', 'conduct', 'derive-feedback', '--sha', 'abc'])).toBeNull();
    });

    it('returns null for no subcommand at all', () => {
      expect(detectTaskCommand(['node', 'conduct'])).toBeNull();
    });

    it('returns null for arbitrary argv not containing task', () => {
      expect(detectTaskCommand(['some', 'other', 'command'])).toBeNull();
    });
  });
});
