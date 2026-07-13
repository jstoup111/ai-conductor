import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/engine/config.js';

describe('validateConfig — kickback_escalation config (D2 toggle, #647 Task 5)', () => {
  it('defaults to enabled: true when the block is absent', () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: true });
    }
  });

  it('accepts an explicit enabled: false', () => {
    const result = validateConfig({ kickback_escalation: { enabled: false } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: false });
    }
  });

  it('accepts an explicit enabled: true', () => {
    const result = validateConfig({ kickback_escalation: { enabled: true } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: true });
    }
  });

  it('fails safe to enabled: true on a malformed block (unknown key)', () => {
    const result = validateConfig({ kickback_escalation: { bogus_key: true } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: true });
    }
  });

  it('fails safe to enabled: true on a non-boolean enabled value', () => {
    const result = validateConfig({ kickback_escalation: { enabled: 'nope' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: true });
    }
  });

  it('fails safe to enabled: true when kickback_escalation is not an object', () => {
    const result = validateConfig({ kickback_escalation: 'nope' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.kickback_escalation).toEqual({ enabled: true });
    }
  });
});
