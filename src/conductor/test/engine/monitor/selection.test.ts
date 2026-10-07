// Covers: task:7, task:8
import { describe, expect, it } from 'vitest';
import { resolveGuidedSessionSelection } from '../../../src/engine/monitor/selection.js';

describe('guided-session selection', () => {
  it('uses overrides, monitor config, then built-in defaults and reports their sources', () => {
    expect(resolveGuidedSessionSelection({
      config: { llm_provider: 'claude', monitor: { llm_provider: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' } },
      overrides: { model: 'gpt-5.6-sol' },
    })).toEqual({
      kind: 'selected', provider: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh',
      sources: { provider: 'config', model: 'override', effort: 'config' },
    });
  });

  it('does not borrow monitor model or effort when a provider override is selected', () => {
    expect(resolveGuidedSessionSelection({
      config: { monitor: { llm_provider: 'claude', model: 'opus', effort: 'low' } },
      overrides: { provider: 'codex' },
    })).toMatchObject({
      kind: 'selected', provider: 'codex', model: 'gpt-5.6-sol', effort: 'high',
      sources: { provider: 'override', model: 'default', effort: 'default' },
    });
  });

  it.each([
    [{ config: {}, overrides: { provider: 'gemini' } }, 'monitor: unregistered provider gemini.'],
    [{ config: { monitor: { llm_provider: 'pi' } } }, 'monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).'],
    [{ config: {}, overrides: { effort: 'turbo' as any } }, 'monitor: effort "turbo" is not accepted by provider claude.'],
    [{ config: {}, overrides: { model: '--bad' } }, 'monitor: model "--bad" is not a valid model id for provider claude.'],
    [{ config: {}, overrides: { model: 'opus high' } }, 'monitor: model "opus high" is not a valid model id for provider claude.'],
  ])('refuses invalid guided-session input', (input, message) => {
    expect(resolveGuidedSessionSelection(input)).toEqual({ kind: 'refused', message });
  });
});
