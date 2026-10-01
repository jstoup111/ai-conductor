import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { scanInheritedState } from '../daemon-dashboard.js';
import { HALT_MARKER, readHaltSidecarClassification, type HaltDisposition } from '../halt-marker.js';
import { isOperatorParked } from '../park-marker.js';
import { createRegistryReader, type RegistryReader } from '../registry.js';

export interface ProjectHalt {
  project: string;
  projectName?: string;
  slug: string;
  reason: string;
  haltClass: HaltDisposition;
  /** The linked intake issue, when this feature was created from one. */
  sourceRef?: string;
}

async function readSourceRef(worktreePath: string, slug: string): Promise<string | undefined> {
  try {
    const contents = await readFile(join(worktreePath, '.docs', 'intake', `${slug}.md`), 'utf-8');
    return /^\s*Source-Ref:\s*(\S+)/im.exec(contents)?.[1];
  } catch {
    return undefined;
  }
}

async function haltDetails(worktreePath: string, slug: string): Promise<Pick<ProjectHalt, 'haltClass' | 'sourceRef'>> {
  const [haltClass, sourceRef] = await Promise.all([
    readHaltSidecarClassification(worktreePath),
    readSourceRef(worktreePath, slug),
  ]);
  return sourceRef === undefined ? { haltClass } : { haltClass, sourceRef };
}

export interface HaltInventoryDeps {
  isOperatorParked: (projectRoot: string, slug: string) => Promise<boolean>;
}

export interface RegisteredHaltInventorySelection {
  projectName?: string;
}

export interface RegisteredHaltInventoryResult {
  code: number;
  halts: ProjectHalt[];
  /** Registry selection is invalid; continuing to poll cannot change it. */
  terminal?: boolean;
}

export interface RegisteredHaltInventoryDeps {
  registryPath?: string;
  registryReader?: RegistryReader;
  enumerateProjectHalts?: (projectRoot: string) => Promise<ProjectHalt[]>;
  readProjectDirectory?: (projectRoot: string) => Promise<void>;
  out?: (line: string) => void;
}

function firstHaltLine(contents: string): string {
  for (const line of contents.split('\n')) {
    const reason = line.trim();
    if (reason) return reason;
  }
  return 'unstated';
}

function readFailureReason(error: unknown): string {
  return `HALT marker unreadable: ${error instanceof Error ? error.message : String(error)}`;
}

async function hasReadableCompletionMarker(worktreePath: string): Promise<boolean> {
  try {
    await readFile(join(worktreePath, '.pipeline/DONE'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function unreadableHaltSlugs(worktreeBase: string, knownSlugs: Set<string>): Promise<string[]> {
  try {
    const entries = await readdir(worktreeBase, { withFileTypes: true });
    const unreadable: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || knownSlugs.has(entry.name)) continue;
      const worktreePath = join(worktreeBase, entry.name);
      const markerPath = join(worktreePath, HALT_MARKER);
      try {
        await stat(markerPath);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
          && !await hasReadableCompletionMarker(worktreePath)
        ) unreadable.push(entry.name);
        continue;
      }
      try {
        await readFile(markerPath, 'utf-8');
      } catch {
        if (!await hasReadableCompletionMarker(worktreePath)) unreadable.push(entry.name);
      }
    }
    return unreadable;
  } catch {
    return [];
  }
}

/**
 * Enumerate the live halted worktrees for one project.
 *
 * Membership remains owned by the inherited-state scan, including its
 * completion-marker and per-worktree-error handling. Halt classification is
 * deliberately read beside each live entry because it is not part of the
 * dashboard's halted-entry shape.
 */
export async function enumerateProjectHalts(
  projectRoot: string,
  deps: HaltInventoryDeps = { isOperatorParked },
): Promise<ProjectHalt[]> {
  const worktreeBase = join(projectRoot, '.worktrees');
  const state = await scanInheritedState({
    worktreeBase,
    processedDir: join(projectRoot, '.daemon', 'processed'),
    discover: async () => [],
  });

  const knownSlugs = new Set(state.halted.map(({ slug }) => slug));
  const halted = (await Promise.all(state.halted.map(async ({ slug }) => {
    const worktreePath = join(worktreeBase, slug);
    if (await deps.isOperatorParked(projectRoot, slug)) return null;
    try {
      return {
        project: projectRoot,
        slug,
        reason: firstHaltLine(await readFile(join(worktreePath, HALT_MARKER), 'utf-8')),
        ...await haltDetails(worktreePath, slug),
      };
    } catch (error) {
      return {
        project: projectRoot,
        slug,
        reason: readFailureReason(error),
        ...await haltDetails(worktreePath, slug),
      };
    }
  }))).filter((halt): halt is ProjectHalt => halt !== null);

  const unreadable = await unreadableHaltSlugs(worktreeBase, knownSlugs);
  const unreadableEntries = (await Promise.all(unreadable.map(async (slug) => {
    const worktreePath = join(worktreeBase, slug);
    if (await deps.isOperatorParked(projectRoot, slug)) return null;
    let reason = 'HALT marker unreadable';
    try {
      await readFile(join(worktreePath, HALT_MARKER), 'utf-8');
    } catch (error) {
      reason = readFailureReason(error);
    }
    return {
      project: projectRoot,
      slug,
      reason,
      ...await haltDetails(worktreePath, slug),
    };
  }))).filter((halt): halt is ProjectHalt => halt !== null);

  return [...halted, ...unreadableEntries];
}

export async function enumerateRegisteredProjectHalts(
  selection: RegisteredHaltInventorySelection = {},
  deps: RegisteredHaltInventoryDeps = {},
): Promise<RegisteredHaltInventoryResult> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const registryReader = deps.registryReader ?? createRegistryReader(
    deps.registryPath ? { registryPath: deps.registryPath } : {},
  );
  let projects;
  try {
    projects = await registryReader.listProjects();
  } catch (error) {
    out(`registry unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return { code: 1, halts: [], terminal: true };
  }

  const selected = selection.projectName === undefined
    ? projects
    : projects.filter((project) => project.name === selection.projectName);
  if (selection.projectName !== undefined && selected.length === 0) {
    out(`unknown project: ${selection.projectName}`);
    return { code: 1, halts: [], terminal: true };
  }
  if (selected.length === 0) {
    out('no registered projects');
    return { code: 0, halts: [] };
  }

  const enumerate = deps.enumerateProjectHalts ?? enumerateProjectHalts;
  const readProjectDirectory = deps.readProjectDirectory ?? (async (projectRoot: string) => {
    await readdir(projectRoot);
  });
  const halts: ProjectHalt[] = [];
  let code = 0;
  for (const project of selected) {
    try {
      await readProjectDirectory(project.path);
      const projectHalts = await enumerate(project.path);
      halts.push(...projectHalts.map((halt) => ({
        ...halt,
        project: project.path,
        projectName: project.name,
      })));
    } catch (error) {
      code = 1;
      out(`${project.name}: unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { code, halts };
}
