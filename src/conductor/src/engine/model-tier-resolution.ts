import type { ProviderModelPolicy } from './provider-model-policy-defaults.js';

const TIERED_MODEL_ID = /^gpt-(\d+(?:\.\d+)*)-(luna|terra|sol|astra)$/;

type ModelTier = 'luna' | 'terra' | 'sol' | 'astra';

interface TieredModelId {
  readonly id: string;
  readonly version: readonly bigint[];
  readonly tier: ModelTier;
}

function parseTieredModelId(id: string): TieredModelId | undefined {
  const match = TIERED_MODEL_ID.exec(id);
  if (match === null) return undefined;

  return {
    id,
    version: match[1]!.split('.').map((segment) => BigInt(segment)),
    tier: match[2]! as ModelTier,
  };
}

function compareVersions(left: readonly bigint[], right: readonly bigint[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0n) - (right[index] ?? 0n);
    if (difference < 0n) return -1;
    if (difference > 0n) return 1;
  }
  return 0;
}

/** Resolves each floor to the newest strictly newer catalog id in its own tier. */
export function resolveModelTierFloors(
  floors: readonly string[],
  listedIds: readonly string[],
): ReadonlyMap<string, string> {
  const listed = listedIds.flatMap((id) => {
    const parsed = parseTieredModelId(id);
    return parsed === undefined ? [] : [parsed];
  });

  return new Map(floors.map((floor) => {
    const parsedFloor = parseTieredModelId(floor);
    if (parsedFloor === undefined) return [floor, floor] as const;

    const newest = listed.reduce<TieredModelId | undefined>((best, candidate) => {
      if (
        candidate.tier !== parsedFloor.tier
        || compareVersions(candidate.version, parsedFloor.version) <= 0
        || (best !== undefined && compareVersions(candidate.version, best.version) <= 0)
      ) return best;
      return candidate;
    }, undefined);

    return [floor, newest?.id ?? floor] as const;
  }));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function resolveModel(model: string, resolvedIds: ReadonlyMap<string, string>): string {
  return resolvedIds.get(model) ?? model;
}

/** Returns a frozen policy with every policy-owned model id replaced from the tier map. */
export function materializeModelTierPolicy(
  policy: ProviderModelPolicy,
  resolvedIds: ReadonlyMap<string, string>,
): ProviderModelPolicy {
  return deepFreeze({
    ...policy,
    stepModels: Object.fromEntries(Object.entries(policy.stepModels).map(([step, model]) => [
      step,
      resolveModel(model, resolvedIds),
    ])) as ProviderModelPolicy['stepModels'],
    stepTierOverrides: Object.fromEntries(Object.entries(policy.stepTierOverrides).map(([step, tiers]) => [
      step,
      Object.fromEntries(Object.entries(tiers ?? {}).map(([tier, override]) => [
        tier,
        override?.model === undefined
          ? { ...override }
          : { ...override, model: resolveModel(override.model, resolvedIds) },
      ])),
    ])) as ProviderModelPolicy['stepTierOverrides'],
    modelEscalationOrder: policy.modelEscalationOrder.map((model) => resolveModel(model, resolvedIds)),
    modelFallbackLadder: policy.modelFallbackLadder.map((model) => resolveModel(model, resolvedIds)),
  });
}

const resolvedPolicies = new Map<string, ProviderModelPolicy>();

/** Installs a process-local, materialized policy for dispatching consumers. */
export function installResolvedModelTiers(
  providerKey: string,
  policy: ProviderModelPolicy,
  resolvedIds: ReadonlyMap<string, string>,
): void {
  resolvedPolicies.set(providerKey, materializeModelTierPolicy(policy, resolvedIds));
}

export function resolvedModelTierPolicy(providerKey: string): ProviderModelPolicy | undefined {
  return resolvedPolicies.get(providerKey);
}

/** Test-only registry reset; production policy resolution remains process-local. */
export function resetResolvedModelTiersForTest(): void {
  resolvedPolicies.clear();
}
