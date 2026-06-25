// `conduct register` / `conduct create` command handlers (Phase 9.2, ADR-003).
//
// These are NON-INTERACTIVE: they run to completion and the caller exits with
// the returned code. They are the CLI face of the single-writer registry module
// (registry.ts) — all registry mutation goes through upsertProject.
//
// register [path] — validate the path is an existing git repo, derive the
//   record (name=basename, absolute path, redacted origin remote), upsert with
//   status `registered`. A bad path or a registry write failure is REPORTED via
//   a non-zero exit; the registry is left byte-unchanged on a validation reject.
//
// create <name> [--remote url] — no-clobber guard, then scaffold a skeleton
//   (git init + template CLAUDE.md + .gitignore) and upsert with status
//   `created`. A non-empty target writes NOTHING.

import { execa } from 'execa';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, isAbsolute, resolve as resolvePath } from 'path';
import {
  resolveRegistryPath,
  upsertProject,
  redactRemote,
  SCHEMA_VERSION,
  type ProjectRecord,
} from './registry.js';

// Resolve the registry path from the environment (honors $AI_CONDUCTOR_REGISTRY).
function registryPath(): string {
  return resolveRegistryPath({ env: process.env });
}

async function isGitRepo(dir: string): Promise<boolean> {
  const r = await execa(
    'git',
    ['-C', dir, 'rev-parse', '--is-inside-work-tree'],
    { reject: false },
  );
  return r.exitCode === 0 && String(r.stdout).trim() === 'true';
}

// Discover and redact the origin remote, or undefined when there is none.
async function discoverRemote(dir: string): Promise<string | undefined> {
  const r = await execa(
    'git',
    ['-C', dir, 'remote', 'get-url', 'origin'],
    { reject: false },
  );
  if (r.exitCode !== 0) return undefined;
  const url = String(r.stdout).trim();
  if (!url) return undefined;
  return redactRemote(url);
}

// `conduct register [path]` — returns the process exit code.
export async function runRegister(pathArg?: string): Promise<number> {
  const target = pathArg ?? process.cwd();
  const abs = isAbsolute(target) ? target : resolvePath(process.cwd(), target);

  if (!existsSync(abs)) {
    console.error(`conduct register: path does not exist: ${abs}`);
    return 1;
  }
  if (!(await isGitRepo(abs))) {
    console.error(`conduct register: not a git repository: ${abs}`);
    return 1;
  }

  const remote = await discoverRemote(abs);
  const record: ProjectRecord = {
    schemaVersion: SCHEMA_VERSION,
    name: basename(abs),
    path: abs,
    status: 'registered',
    registeredAt: new Date().toISOString(),
    ...(remote ? { remote } : {}),
  };

  try {
    await upsertProject(registryPath(), record);
  } catch (e) {
    console.error(
      `conduct register: failed to write registry: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }
  console.log(`Registered ${record.name} (${abs}).`);
  return 0;
}

// Minimal skeleton CLAUDE.md referencing HARNESS.md. `create` is intentionally a
// thin scaffold (ADR-003): no stack detection — that stays in /bootstrap.
function skeletonClaudeMd(name: string): string {
  return `# ${name}

This project uses the james-stoup-agents harness. Behavioral rules, model
selection, communication protocol, and conventions are defined in the harness
**HARNESS.md** — Claude MUST read and follow it at the start of every session.

Run \`/bootstrap\` to detect the tech stack and generate full project config.
`;
}

const GITIGNORE_SKELETON = ['.pipeline/', '.daemon/', '.worktrees/', ''].join('\n');

async function dirIsNonEmpty(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

// `conduct create <name> [--remote url]` — returns the process exit code.
export async function runCreate(
  name: string,
  opts: { remote?: string } = {},
): Promise<number> {
  const target = resolvePath(process.cwd(), name);

  // No-clobber: a non-empty target writes NOTHING (no scaffold, no record).
  if (await dirIsNonEmpty(target)) {
    console.error(
      `conduct create: target is not empty, refusing to clobber: ${target}`,
    );
    return 1;
  }

  try {
    await mkdir(target, { recursive: true });
    await execa('git', ['init', '-q', target]);
    await writeFile(join(target, 'CLAUDE.md'), skeletonClaudeMd(basename(target)), 'utf-8');
    await writeFile(join(target, '.gitignore'), GITIGNORE_SKELETON, 'utf-8');
    if (opts.remote) {
      // add-only — NO push.
      await execa('git', ['-C', target, 'remote', 'add', 'origin', opts.remote]);
    }
  } catch (e) {
    console.error(
      `conduct create: scaffold failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }

  const record: ProjectRecord = {
    schemaVersion: SCHEMA_VERSION,
    name: basename(target),
    path: target,
    status: 'created',
    registeredAt: new Date().toISOString(),
    ...(opts.remote ? { remote: opts.remote } : {}),
  };

  try {
    await upsertProject(registryPath(), record);
  } catch (e) {
    console.error(
      `conduct create: failed to write registry: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }
  console.log(`Created ${record.name} (${target}).`);
  return 0;
}

// Detect whether argv targets a registry subcommand so the CLI entry can route
// to a non-interactive handler instead of the interactive pipeline. Returns the
// matched handler invocation, or null when argv is a normal pipeline run.
export type RegistryDispatch =
  | { kind: 'register'; path?: string }
  | { kind: 'create'; name: string; remote?: string };

export function detectRegistryCommand(argv: string[]): RegistryDispatch | null {
  // argv is process.argv: [node, entry, sub, ...]
  const args = argv.slice(2);
  const sub = args[0];
  if (sub === 'register') {
    const path = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
    return { kind: 'register', path };
  }
  if (sub === 'create') {
    const rest = args.slice(1);
    let name: string | undefined;
    let remote: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--remote') {
        remote = rest[i + 1];
        i++;
      } else if (a.startsWith('--remote=')) {
        remote = a.slice('--remote='.length);
      } else if (!a.startsWith('-') && name === undefined) {
        name = a;
      }
    }
    if (name === undefined) return null;
    return { kind: 'create', name, remote };
  }
  return null;
}

// Read a record back (used by integration helpers/tests). Thin re-export shim.
export async function dispatchRegistry(d: RegistryDispatch): Promise<number> {
  if (d.kind === 'register') return runRegister(d.path);
  return runCreate(d.name, { remote: d.remote });
}

// Convenience for callers that prefer to read the registry path.
export { registryPath };
