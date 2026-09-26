// Covers: task:1, task:2
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_PROVIDERS,
  DEFAULT_PROVIDER,
  ProviderCapabilityUnsupportedError,
  requireProviderCapability,
  resolveProviderExecutable,
  supportsProviderCapability,
  type ProviderCapabilityFlags,
  type ProviderWith,
} from '../../src/execution/provider-catalog.js';

const executableOverrides = ['CLAUDE_EXECUTABLE', 'CODEX_EXECUTABLE'] as const;
const originalExecutableOverrides = new Map(
  executableOverrides.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of executableOverrides) {
    const value = originalExecutableOverrides.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('built-in provider catalog', () => {
  it('declares the existing built-in provider ids and default provider', () => {
    expect(BUILT_IN_PROVIDERS.map(({ id }) => id)).toEqual(['claude', 'codex']);
    expect(DEFAULT_PROVIDER).toBe('claude');
  });

  it.each([
    {
      provider: 'claude',
      override: 'CLAUDE_EXECUTABLE',
      overriddenExecutable: '/opt/claude/bin/claude',
      defaultExecutable: 'claude',
    },
    {
      provider: 'codex',
      override: 'CODEX_EXECUTABLE',
      overriddenExecutable: '/opt/codex/bin/codex',
      defaultExecutable: 'codex',
    },
  ] as const)('resolves $provider executable overrides and defaults', ({
    provider,
    override,
    overriddenExecutable,
    defaultExecutable,
  }) => {
    process.env[override] = overriddenExecutable;
    expect(resolveProviderExecutable(provider)).toBe(overriddenExecutable);

    delete process.env[override];
    expect(resolveProviderExecutable(provider)).toBe(defaultExecutable);
  });

  it.each([
    'readiness',
    'selfHost',
    'readOnlyReview',
    'reviewPolicyCatalog',
    'supportsSessionResume',
    'costSelfReporting',
    'writeFence',
    'nativeSchema',
  ] as const)('fails closed when a descriptor omits %s capability', (capability) => {
    expect(supportsProviderCapability({ capabilities: {} }, capability)).toBe(false);
  });

  it('refuses an undeclared self-host capability by provider, capability, and intake', () => {
    const claude = BUILT_IN_PROVIDERS.find((provider) => provider.id === 'claude')!;
    const capabilities = claude.capabilities;

    try {
      Object.defineProperty(claude, 'capabilities', {
        configurable: true,
        value: { ...capabilities, selfHost: false } satisfies ProviderCapabilityFlags,
      });

      const requireSelfHost = () => requireProviderCapability('claude', 'selfHost');
      expect(requireSelfHost).toThrow(ProviderCapabilityUnsupportedError);
      expect(requireSelfHost).toThrow(
        /claude.*selfHost.*#1887/,
      );
    } finally {
      Object.defineProperty(claude, 'capabilities', { configurable: true, value: capabilities });
    }

    const provider: ProviderWith<'selfHost'> = requireProviderCapability('claude', 'selfHost');
    expect(provider).toBe(claude);
  });
});
