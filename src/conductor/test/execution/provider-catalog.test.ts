// Covers: task:1, task:2, task:13
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_PROVIDERS,
  DEFAULT_PROVIDER,
  PROVIDER_CAPABILITY_OWNERS,
  ProviderCapabilityUnsupportedError,
  requireProviderCapability,
  resolveProviderExecutable,
  supportsProviderCapability,
  type BuiltInProviderDescriptor,
  type ProviderCapability,
  type ProviderCapabilityFlags,
  type ProviderWith,
} from '../../src/execution/provider-catalog.js';
import { parsePiModelId, parsePiModelListing } from '../../src/execution/pi-provider.js';
import { rateCardModelIds } from '../../src/engine/provider-model-policy.js';

const executableOverrides = ['CLAUDE_EXECUTABLE', 'CODEX_EXECUTABLE', 'PI_EXECUTABLE'] as const;
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
    expect(BUILT_IN_PROVIDERS.map(({ id }) => id)).toEqual(['claude', 'codex', 'pi']);
    expect(DEFAULT_PROVIDER).toBe('claude');
  });

  it('requires configured Pi models while built-in policies retain their model defaults', () => {
    const policies = BUILT_IN_PROVIDERS.map((provider) => provider.modelPolicy);
    const piPolicy = policies[2]!;

    expect({
      configuredModelRequirements: policies.map((policy) => policy.requiresConfiguredModels),
      piModelEscalationOrder: piPolicy.modelEscalationOrder,
      piModelFallbackLadder: piPolicy.modelFallbackLadder,
      piHasNonEmptyStepModel: Object.values(piPolicy.stepModels).some(Boolean),
    }).toEqual({
      configuredModelRequirements: [false, false, true],
      piModelEscalationOrder: [],
      piModelFallbackLadder: [],
      piHasNonEmptyStepModel: false,
    });
  });

  it('never sends an empty model id to rate-card refreshes', () => {
    expect(rateCardModelIds()).not.toContain('');
  });

  it('declares Pi cost self-reporting while retaining its unsupported capabilities', () => {
    const pi = BUILT_IN_PROVIDERS.find((provider) => provider.id === 'pi')!;

    expect({
      costSelfReporting: supportsProviderCapability(pi, 'costSelfReporting'),
      unsupported: [
        'selfHost',
        'reviewPolicyCatalog',
        'writeFence',
        'readiness',
        'interactiveLaunch',
      ].map((capability) => [
        capability,
        supportsProviderCapability(pi, capability as ProviderCapability),
      ]),
      capabilityOwners: PROVIDER_CAPABILITY_OWNERS,
    }).toEqual({
      costSelfReporting: true,
      unsupported: [
        ['selfHost', false],
        ['reviewPolicyCatalog', false],
        ['writeFence', false],
        ['readiness', false],
        ['interactiveLaunch', false],
      ],
      capabilityOwners: {
        selfHost: '#1887',
        interactiveLaunch: '#1007',
        readOnlyReview: '#1886',
        reviewPolicyCatalog: '#2852',
      },
    });
  });

  it('declares Pi model parsing only on the Pi descriptor', () => {
    const parserByProvider = Object.fromEntries(
      BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.parseModelId]),
    );

    expect(parserByProvider).toEqual({
      claude: undefined,
      codex: undefined,
      pi: parsePiModelId,
    });
  });

  it('declares Pi model listing only on the Pi descriptor', () => {
    const catalogByProvider = Object.fromEntries(
      BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.modelCatalog]),
    );

    expect(catalogByProvider).toEqual({
      claude: undefined,
      codex: undefined,
      pi: { argv: ['--list-models'], parse: parsePiModelListing },
    });
  });

  it('declares interactive launch mechanics without changing read-only review admission', () => {
    const providers = BUILT_IN_PROVIDERS as readonly BuiltInProviderDescriptor[];
    const provider = (id: string) => providers.find((candidate) => candidate.id === id)!;
    const unsupportedMessage = (capability: ProviderCapability) => {
      try {
        requireProviderCapability('pi', capability);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    };

    expect({
      interactiveLaunch: providers.map((candidate) =>
        supportsProviderCapability(candidate, 'interactiveLaunch')),
      interactiveLaunchUnsupported: unsupportedMessage('interactiveLaunch'),
      sessionMarkers: providers.map((candidate) => candidate.interactiveLaunch?.sessionMarkers),
      claudeArgv: [
        provider('claude').interactiveLaunch!.argv('/composer', {}),
        provider('claude').interactiveLaunch!.argv('/composer', {
          CONDUCT_ENGINEER_PERMISSION_MODE: 'plan',
        }),
      ],
      codexArgv: provider('codex').interactiveLaunch!.argv('$composer', {}),
      readOnlyReview: providers.map((candidate) =>
        supportsProviderCapability(candidate, 'readOnlyReview')),
      readOnlyReviewUnsupported: unsupportedMessage('readOnlyReview'),
    }).toEqual({
      interactiveLaunch: [true, true, false],
      interactiveLaunchUnsupported: expect.stringMatching(/pi.*interactiveLaunch.*#1007/),
      sessionMarkers: [['CLAUDECODE'], ['CODEX_THREAD_ID', 'CODEX_SESSION_ID'], undefined],
      claudeArgv: [
        ['--permission-mode', 'default', '/composer'],
        ['--permission-mode', 'default', '/composer'],
      ],
      codexArgv: ['$composer'],
      readOnlyReview: [true, true, true],
      readOnlyReviewUnsupported: undefined,
    });
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
    {
      provider: 'pi',
      override: 'PI_EXECUTABLE',
      overriddenExecutable: '/opt/pi/bin/pi',
      defaultExecutable: 'pi',
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

  it('declares Pi\'s agent home and keeps its review-policy capability with its follow-up intake', () => {
    const pi = BUILT_IN_PROVIDERS.find((provider) => provider.id === 'pi')!;

    expect(pi).toMatchObject({
      homeVariable: 'PI_CODING_AGENT_DIR',
      defaultHome: '.pi/agent',
    });
    expect(pi.capabilities).not.toHaveProperty('reviewPolicyCatalog');
    expect(pi.capabilities).not.toHaveProperty('readiness');
    expect(PROVIDER_CAPABILITY_OWNERS.reviewPolicyCatalog).toBe('#2852');

    const requireReviewPolicyCatalog = () => requireProviderCapability('pi', 'reviewPolicyCatalog');
    expect(requireReviewPolicyCatalog).toThrow(ProviderCapabilityUnsupportedError);
    expect(requireReviewPolicyCatalog).toThrow(/#2852/);
    expect(requireReviewPolicyCatalog).not.toThrow(/#1888/);
    try {
      requireReviewPolicyCatalog();
    } catch (error) {
      expect(error).toMatchObject({
        owningIntake: '#2852',
      });
    }
  });
});
