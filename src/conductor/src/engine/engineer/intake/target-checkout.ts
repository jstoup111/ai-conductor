import { execa } from 'execa';
import { createRegistryReader, type RegistryReader } from '../../registry.js';

export type TargetCheckout =
  | { kind: 'checkout'; path: string }
  | { kind: 'none'; reason: 'no-match' | 'ambiguous' };

export type OriginOf = (cwd: string) => Promise<string | undefined>;

export interface ResolveTargetCheckoutOptions {
  readonly cwd: string;
  readonly repository: string;
  readonly registryReader?: RegistryReader;
  readonly originOf?: OriginOf;
}

function repositoryFromRemote(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim());
  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : undefined;
}

async function originAt(cwd: string): Promise<string | undefined> {
  const result = await execa('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { reject: false });
  if (result.exitCode !== 0) return undefined;
  const remote = result.stdout.trim();
  return remote || undefined;
}

/**
 * Resolve the local checkout for a target GitHub repository without ever
 * falling back to the harness checkout. The invoking checkout wins; otherwise
 * an exactly-one registry match is safe to use.
 */
export async function resolveTargetCheckout(
  options: ResolveTargetCheckoutOptions,
): Promise<TargetCheckout> {
  const repository = options.repository.trim().toLowerCase();
  const originOf = options.originOf ?? originAt;
  const cwdRepository = repositoryFromRemote(await originOf(options.cwd));
  if (cwdRepository === repository) return { kind: 'checkout', path: options.cwd };

  const reader = options.registryReader ?? createRegistryReader();
  const matches = (await reader.listProjects())
    .filter((record) => repositoryFromRemote(record.remote) === repository);
  if (matches.length === 1) return { kind: 'checkout', path: matches[0].path };
  return matches.length === 0
    ? { kind: 'none', reason: 'no-match' }
    : { kind: 'none', reason: 'ambiguous' };
}
