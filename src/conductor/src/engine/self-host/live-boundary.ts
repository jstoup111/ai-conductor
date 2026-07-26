import { createHash } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';

interface Surface { root: string; label: string; exclude: readonly string[]; manifest: readonly Entry[]; }
interface Entry { path: string; digest: string; }
export interface LiveBoundarySnapshot { readonly surfaces: readonly Surface[]; }

async function manifest(root: string, exclude: readonly string[]): Promise<Entry[]> {
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
  };
  let files: string[];
  try {
    files = await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [{ path: '<absent>', digest: '' }];
    throw error;
  }
  return Promise.all(files.map(async file => {
    const path = relative(root, file);
    const bytes = await readFile(file).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === 'EISDIR' || error.code === 'ENOENT') return readlink(file);
      throw error;
    });
    return { path, digest: createHash('sha256').update(bytes).digest('hex') };
  })).then(entries => entries.filter(entry => !exclude.includes(entry.path)).sort((a, b) => a.path.localeCompare(b.path)));
}

export async function fingerprintLiveBoundary(args: {
  liveCheckout: string; unrelatedProviderState: string; selectedAuthPaths?: readonly string[];
}): Promise<LiveBoundarySnapshot> {
  const excluded = args.selectedAuthPaths ?? [];
  return { surfaces: [
    { root: args.liveCheckout, label: 'live checkout', exclude: [], manifest: await manifest(args.liveCheckout, []) },
    { root: args.unrelatedProviderState, label: 'provider state', exclude: excluded, manifest: await manifest(args.unrelatedProviderState, excluded) },
  ] };
}

export async function verifyLiveBoundary(snapshot: LiveBoundarySnapshot): Promise<{ ok: boolean; reason?: string }> {
  for (const surface of snapshot.surfaces) {
    const current = await manifest(surface.root, surface.exclude);
    if (JSON.stringify(current) !== JSON.stringify(surface.manifest)) {
      return { ok: false, reason: `${surface.label} changed during self-host execution.` };
    }
  }
  return { ok: true };
}
