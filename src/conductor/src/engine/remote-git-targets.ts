import type { GithubRemoteRefTarget } from './github-operations.js';

/** Read-only Git configuration seam. Remote mutation stays outside this module. */
export interface RemoteGitConfigReader {
  (args: string[]): Promise<{ readonly stdout: string }>;
}

export type RemoteGitDestination = GithubRemoteRefTarget & {
  readonly operation: 'remote-ref.push' | 'remote-ref.delete';
};

export type RemoteGitTargetResolution =
  | {
    readonly kind: 'resolved';
    readonly remote: string;
    readonly targets: readonly RemoteGitDestination[];
  }
  | { readonly kind: 'not-remote-write' }
  | { readonly kind: 'refused'; readonly reason: 'invalid-target' };

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const REMOTE_NAME = /^(?!-)[A-Za-z0-9_.-]+$/;

function invalidTarget(): RemoteGitTargetResolution {
  return { kind: 'refused', reason: 'invalid-target' };
}

function validDestinationRef(ref: string): boolean {
  return ref.startsWith('refs/')
    && ref.length > 'refs/'.length
    && !ref.startsWith('refs/tags/')
    && !ref.includes('//')
    && !ref.endsWith('/')
    && !ref.includes('..')
    && !ref.endsWith('.')
    && !ref.includes('@{')
    && !/[\s~^:\\?*\[]/.test(ref);
}

function canonicalRepository(owner: string, name: string): string | undefined {
  if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(name)) return undefined;
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

/** Resolve only GitHub's commonly configured HTTPS and SSH remote URL forms. */
function repositoryFromRemoteUrl(value: string): string | undefined {
  const url = value.trim();
  if (url === '' || /\s/.test(url)) return undefined;

  const scp = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(url);
  if (scp) return canonicalRepository(scp[1], scp[2]);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!['https:', 'ssh:'].includes(parsed.protocol)
    || parsed.hostname.toLowerCase() !== 'github.com'
    || parsed.search
    || parsed.hash) {
    return undefined;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return undefined;
  const name = segments[1].endsWith('.git') ? segments[1].slice(0, -'.git'.length) : segments[1];
  return canonicalRepository(segments[0], name);
}

function isKnownPushOption(value: string): boolean {
  return [
    '--atomic', '--force', '--no-verify', '--porcelain', '--quiet', '--set-upstream', '--signed', '--thin', '--verbose',
    '-f', '-q', '-u', '-v',
  ].includes(value)
    || value.startsWith('--force-with-lease=')
    || value === '--force-with-lease';
}

type ParsedPush = {
  readonly remote: string;
  readonly refspecs: readonly string[];
  readonly deleteRequested: boolean;
};

/**
 * Parse the bounded push grammar accepted by this adapter. Anything that lets
 * Git infer extra targets is rejected rather than delegated to Git's defaults.
 */
function parsePush(args: readonly string[]): ParsedPush | undefined {
  if (args.length === 0 || args[0] !== 'push') return undefined;

  let deleteRequested = false;
  const positional: string[] = [];
  for (const token of args.slice(1)) {
    if (token === '--delete' || token === '-d') {
      if (deleteRequested) return undefined;
      deleteRequested = true;
      continue;
    }
    if (['--all', '--follow-tags', '--mirror', '--tags'].includes(token)) return undefined;
    if (token.startsWith('-')) {
      if (!isKnownPushOption(token)) return undefined;
      continue;
    }
    positional.push(token);
  }

  const [remote, ...refspecs] = positional;
  if (!remote || !REMOTE_NAME.test(remote) || refspecs.length === 0) return undefined;
  return { remote, refspecs, deleteRequested };
}

function destinationForRefspec(refspec: string, deleteRequested: boolean): { ref: string; operation: RemoteGitDestination['operation'] } | undefined {
  if (refspec.includes('*') || refspec.includes('...')) return undefined;
  if (deleteRequested) {
    if (!validDestinationRef(refspec)) return undefined;
    return { ref: refspec, operation: 'remote-ref.delete' };
  }

  const colon = refspec.indexOf(':');
  if (colon === -1 || colon !== refspec.lastIndexOf(':')) return undefined;
  const source = refspec.slice(0, colon).replace(/^\+/, '');
  const destination = refspec.slice(colon + 1);
  if (destination === '' || !validDestinationRef(destination)) return undefined;
  return {
    ref: destination,
    operation: source === '' ? 'remote-ref.delete' : 'remote-ref.push',
  };
}

/**
 * Resolve the actual endpoint Git will use for a named remote write.  `get-url
 * --push` applies both a remote's pushurl and pushInsteadOf rewrites, unlike a
 * direct read of the fetch URL configuration.
 */
async function repositoryForRemote(remote: string, gitConfig: RemoteGitConfigReader): Promise<string | undefined> {
  let output: { readonly stdout: string };
  try {
    output = await gitConfig(['remote', 'get-url', '--push', remote]);
  } catch {
    return undefined;
  }
  if (!output || typeof output.stdout !== 'string') return undefined;
  const lines = output.stdout.split(/\r?\n/).filter((line) => line !== '');
  return lines.length === 1 ? repositoryFromRemoteUrl(lines[0]) : undefined;
}

/**
 * Resolve an explicit remote Git destination set before it can reach mutation
 * policy. Local Git commands deliberately return without even reading config.
 */
export async function resolveRemoteGitTargets(
  args: readonly string[],
  gitConfig: RemoteGitConfigReader,
): Promise<RemoteGitTargetResolution> {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return invalidTarget();
  if (args[0] !== 'push') return { kind: 'not-remote-write' };
  if (typeof gitConfig !== 'function') return invalidTarget();

  const parsed = parsePush(args);
  if (!parsed) return invalidTarget();
  const destinations = parsed.refspecs.map((refspec) => destinationForRefspec(refspec, parsed.deleteRequested));
  if (destinations.some((destination) => !destination)) return invalidTarget();

  const repository = await repositoryForRemote(parsed.remote, gitConfig);
  if (!repository) return invalidTarget();
  return {
    kind: 'resolved',
    remote: parsed.remote,
    targets: destinations.map((destination) => ({
      operation: destination!.operation,
      repository,
      kind: 'remote-ref',
      ref: destination!.ref,
    })),
  };
}
