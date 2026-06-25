// Project registry — the SINGLE writer for ~/.ai-conductor/registry.json
// (ADR-003, Phase 9.2). Three entry points (`conduct register`,
// `conduct create`, `/bootstrap`) all funnel through this module so atomicity,
// canonical-path dedup, schema, and credential redaction live in one place.
//
// Path resolution mirrors user-config.ts (injectable for tests). Writes are
// atomic (temp sibling + rename). Dedup is by realpath-canonicalized absolute
// path. Status provenance is preserved: an upsert never downgrades a `created`
// record to `registered`. Write failures are REPORTED (thrown), never swallowed.

import { readFile, writeFile, mkdir, rename, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname, basename, isAbsolute, resolve as resolvePath } from 'path';

export const REGISTRY_DIR = '.ai-conductor';
export const REGISTRY_FILE = 'registry.json';

// Bump when the on-disk record shape changes so the 9.3 reader can evolve.
export const SCHEMA_VERSION = 1;

export type ProjectStatus = 'registered' | 'created';

export interface ProjectRecord {
  schemaVersion: number;
  name: string;
  path: string;
  remote?: string;
  status: ProjectStatus;
  registeredAt: string;
  daemonState?: string;
  lastSignalRef?: string;
}

// Types-only reader surface for the 9.3 consumer. No runtime implementation
// ships here — the registry module is write-side; 9.3 owns the read side.
export interface RegistryReader {
  listProjects(): ProjectRecord[];
  getProject(path: string): ProjectRecord | undefined;
}

export interface ResolveRegistryArgs {
  home?: string;
  env?: Record<string, string | undefined>;
}

// Resolve the registry path: $AI_CONDUCTOR_REGISTRY override wins, else
// <home>/.ai-conductor/registry.json. Throws when neither an override nor a
// usable home is available — never falls back to a relative/wrong location.
export function resolveRegistryPath(args: ResolveRegistryArgs = {}): string {
  const env = args.env ?? process.env;
  const override = env.AI_CONDUCTOR_REGISTRY;
  if (override && override.trim() !== '') {
    return override;
  }
  const home = args.home ?? homedir();
  if (!home || home.trim() === '') {
    throw new Error(
      'Cannot resolve registry path: no $AI_CONDUCTOR_REGISTRY override and home directory is unresolvable.',
    );
  }
  return join(home, REGISTRY_DIR, REGISTRY_FILE);
}

// Read the registry. Absent file → []. Malformed JSON → THROW (a corrupt
// registry must be surfaced, not masked as an empty registry).
export async function readRegistry(path: string): Promise<ProjectRecord[]> {
  if (!existsSync(path)) {
    return [];
  }
  const raw = await readFile(path, 'utf-8');
  if (raw.trim() === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Registry at ${path} is corrupt (invalid JSON): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Registry at ${path} is corrupt: expected a JSON array of records.`);
  }
  return parsed as ProjectRecord[];
}

// Atomic write: serialize the whole registry to a temp sibling, then rename
// over the target (POSIX-atomic — readers never see a partial file). Parent
// dir is auto-created. An unwritable dir surfaces as a thrown error.
//
// Concurrency: each write uses a UNIQUE temp filename so N concurrent writers
// never clobber each other's temp file mid-flight; whichever rename lands last
// wins, and the target is always a complete, valid JSON document.
export async function writeRegistry(path: string, records: ProjectRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = JSON.stringify(records, null, 2);
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, serialized, 'utf-8');
  await rename(tmp, path);
}

// Canonicalize a project path to a stable dedup key: an absolute, realpath-
// resolved path. For a not-yet-existing `create` target the leaf may not exist
// yet, so canonicalize the nearest existing ancestor and re-join the tail (per
// ADR-003).
async function canonicalizePath(p: string): Promise<string> {
  const abs = isAbsolute(p) ? p : resolvePath(p);
  try {
    return await realpath(abs);
  } catch {
    // Leaf doesn't exist — resolve the parent (which should), then rejoin.
    const parent = dirname(abs);
    const leaf = basename(abs);
    try {
      const realParent = await realpath(parent);
      return join(realParent, leaf);
    } catch {
      // Neither leaf nor parent exists on disk — fall back to the absolute path.
      return abs;
    }
  }
}

// Upsert a record keyed by canonicalized absolute path. Re-upserting the same
// canonical path updates the existing record in place (count unchanged).
// Status provenance: a `created` record is NEVER downgraded to `registered`.
// The stored `path` is the canonical form so dedup is stable across the
// symlinked/relative aliases of the same repo.
export async function upsertProject(
  registryPath: string,
  record: ProjectRecord,
): Promise<ProjectRecord[]> {
  const records = await readRegistry(registryPath);
  const canonical = await canonicalizePath(record.path);

  const next: ProjectRecord = { ...record, path: canonical };
  const idx = records.findIndex((r) => r.path === canonical);
  if (idx === -1) {
    records.push(next);
  } else {
    const existing = records[idx];
    // Provenance: keep `created` even if a later upsert says `registered`.
    const status: ProjectStatus =
      existing.status === 'created' ? 'created' : next.status;
    records[idx] = { ...existing, ...next, status };
  }

  await writeRegistry(registryPath, records);
  return records;
}

// Strip embedded credentials from a remote URL before it touches disk (FR-11).
//  - https://user:token@host/p.git → https://host/p.git
//  - ssh://user:pass@host/p.git    → ssh://host/p.git
//  - git@host:o/r.git (scp form)   → unchanged (no password carried)
//  - plain URLs                     → unchanged
export function redactRemote(url: string): string {
  if (!url) return url;
  // scheme://[user[:pass]@]host/... — strip the userinfo segment.
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/]*@)?(.*)$/);
  if (schemeMatch) {
    const [, scheme, , rest] = schemeMatch;
    return `${scheme}${rest}`;
  }
  // scp-style git@host:path — userinfo (the part before @) carries no secret;
  // leave it intact so the remote stays identifiable.
  return url;
}
