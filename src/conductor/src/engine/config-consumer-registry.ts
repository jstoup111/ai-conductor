import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_CONSUMER_KEY_SETS } from './config.js';

export interface ConsumerDeclaration {
  consumer: string | 'none';
  reason?: string;
}

export type ConfigKeySets = Record<string, readonly string[]>;

export function flattenedConfigKeys(sets: ConfigKeySets): string[] {
  return Object.entries(sets).flatMap(([block, keys]) =>
    keys.map((key) => (block === 'top' ? key : `${block}.${key}`)),
  );
}

const validatorConsumer = 'src/conductor/src/engine/config.ts';
export const configConsumerRegistry: Record<string, ConsumerDeclaration> = Object.fromEntries(
  flattenedConfigKeys(CONFIG_CONSUMER_KEY_SETS).map((key) => [key, { consumer: validatorConsumer }]),
);

export function assertRegistryCovers(
  sets: ConfigKeySets,
  registry: Record<string, ConsumerDeclaration>,
  repoRoot = resolve(process.cwd(), '../..'),
): void {
  const accepted = new Set(flattenedConfigKeys(sets));
  for (const key of accepted) {
    const declaration = registry[key];
    if (!declaration) throw new Error(`Config key is undeclared: ${key}`);
    if (declaration.consumer === 'none') {
      if (!declaration.reason?.trim()) throw new Error(`Config key ${key} is none without a reason`);
      continue;
    }
    if (!existsSync(resolve(repoRoot, declaration.consumer))) {
      throw new Error(`Config key ${key} has unresolvable consumer: ${declaration.consumer}`);
    }
  }
  for (const key of Object.keys(registry)) {
    if (!accepted.has(key)) throw new Error(`Config-key declaration is orphaned: ${key}`);
  }
}
