// Covers: task:7, task:8
import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_PROVIDERS, type BuiltInProviderDescriptor } from '../../../src/execution/provider-catalog.js';
import { resolveGuidedSessionSelection } from '../../../src/engine/monitor/selection.js';

const claude = BUILT_IN_PROVIDERS[0];
const catalogProvider: BuiltInProviderDescriptor = {
  ...claude,
  id: 'catalog-provider',
  modelCatalog: BUILT_IN_PROVIDERS[2].modelCatalog,
};

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
    [{ config: {}, overrides: { model: 'opus\u007f' } }, 'monitor: model "opus\u007f" is not a valid model id for provider claude.'],
    [{ config: {}, overrides: { model: 'opus\u0085' } }, 'monitor: model "opus\u0085" is not a valid model id for provider claude.'],
  ])('refuses invalid guided-session input', (input, message) => {
    expect(resolveGuidedSessionSelection(input)).toEqual({ kind: 'refused', message });
  });

  it('refuses an effort excluded by an injected interactive provider', () => {
    const provider: BuiltInProviderDescriptor = {
      ...claude,
      id: 'limited-effort',
      interactiveLaunch: { ...claude.interactiveLaunch!, acceptedEfforts: ['low'] },
    };

    expect(resolveGuidedSessionSelection({
      config: {}, overrides: { provider: provider.id, effort: 'max' },
    }, { findDescriptor: () => provider })).toEqual({
      kind: 'refused',
      message: 'monitor: effort "max" is not accepted by provider limited-effort.',
    });
  });

  it('accepts a well-formed uncatalogued-provider model unchanged without probing a catalog', () => {
    const listCatalogModels = vi.fn();

    expect(resolveGuidedSessionSelection({
      config: {}, overrides: { model: 'claude-fable-5-1' },
    }, { listCatalogModels })).toMatchObject({ kind: 'selected', model: 'claude-fable-5-1' });
    expect(listCatalogModels).not.toHaveBeenCalled();
  });

  it('refuses a model absent from an injected provider catalog', () => {
    const listCatalogModels = vi.fn(() => ['a/b']);

    expect(resolveGuidedSessionSelection({
      config: {}, overrides: { provider: catalogProvider.id, model: 'x/y' },
    }, {
      findDescriptor: () => catalogProvider,
      listCatalogModels,
    })).toEqual({
      kind: 'refused',
      message: 'monitor: model "x/y" is not in provider catalog-provider\'s model catalog.',
    });
    expect(listCatalogModels).toHaveBeenCalledWith(catalogProvider);
  });
});
