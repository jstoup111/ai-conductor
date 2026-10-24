import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

/** A plan-shaped fixture for tests that need sealed stack topology. */
export interface SliceTopologyFixture {
  readonly [key: string]: unknown;
  readonly slug: string;
  readonly sliceMembership: {
    readonly taskSlices: Readonly<Record<string, number>>;
    readonly titles: readonly string[];
  };
  readonly storyOwnership?: Readonly<Record<string, number>>;
}

export interface SliceTopologyFixtureFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const runFile = promisify(execFile);

const defaultFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename: async () => undefined,
};

function planText(fixture: SliceTopologyFixture, storiesPath: string): string {
  const byPosition = new Map<number, string[]>();
  for (const [taskId, position] of Object.entries(fixture.sliceMembership.taskSlices)) {
    const tasks = byPosition.get(position) ?? [];
    tasks.push(taskId);
    byPosition.set(position, tasks);
  }
  const positions = [...byPosition.keys()].sort((left, right) => left - right);
  const rows = positions.map((position) => {
    const title = fixture.sliceMembership.titles[position - 1] ?? `Child ${position}`;
    return `| ${position} | ${title} | ${byPosition.get(position)!.join(', ')} |`;
  });
  const tasks = positions.flatMap((position) => byPosition.get(position)!.sort().map((taskId) => [
    `### Task ${taskId}: Fixture task ${taskId}`,
    `**Story:** S${position}`,
    '**Dependencies:** none',
    '',
  ].join('\n')));
  return [
    `# Implementation Plan: ${fixture.slug}`,
    '',
    `**Stories:** ${storiesPath}`,
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...tasks,
    '',
  ].join('\n');
}

function storiesText(fixture: SliceTopologyFixture): string {
  const positions = [...new Set(Object.values(fixture.sliceMembership.taskSlices))].sort((left, right) => left - right);
  return positions.map((position) => `## Story S${position}: Fixture child ${position}`).join('\n\n');
}

async function recordPositions(projectRoot: string, slug: string, positions: readonly number[]): Promise<void> {
  const marker = join(projectRoot, '.pipeline', 'slice-topology-fixture-positions.json');
  const positionsPath = join(projectRoot, '.pipeline', 'slice-topology-fixture-positions');
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(marker, JSON.stringify({ slug, positions }));
  await writeFile(positionsPath, JSON.stringify(positions));
  if (!existsSync(join(projectRoot, '.git'))) return;
  try {
    const { stdout } = await runFile('git', ['hash-object', '-w', positionsPath], { cwd: projectRoot });
    await runFile('git', ['update-ref', `refs/conductor/${slug}/positions`, stdout.trim()], { cwd: projectRoot });
  } catch {
    // Tests without a local Git boundary still exercise their injected Git seam.
  }
}

/**
 * Materialize a sealed plan and stories artifact instead of the retired
 * coverage-binding cache.  It intentionally writes no `.pipeline` topology
 * file; callers exercise the same plan-derived loader as production.
 */
export async function writeSliceTopologyFixture(
  projectRoot: string,
  fixture: SliceTopologyFixture,
  fs: SliceTopologyFixtureFilesystem = defaultFilesystem,
): Promise<void> {
  let planPath = join(projectRoot, '.docs', 'plans', `${fixture.slug}.md`);
  try {
    const state = JSON.parse(await fs.readFile(join(projectRoot, '.pipeline', 'engine-state.json'))) as { activePlanPath?: unknown };
    if (typeof state.activePlanPath === 'string') {
      planPath = isAbsolute(state.activePlanPath) ? state.activePlanPath : join(projectRoot, state.activePlanPath);
    }
  } catch {
    // Conventional slug-derived plan path is authoritative when no fixture state pins one.
  }
  const storiesPath = `.docs/stories/${fixture.slug}.md`;
  await fs.mkdir(join(projectRoot, '.pipeline'));
  await fs.mkdir(dirname(planPath));
  await fs.mkdir(join(projectRoot, '.docs', 'stories'));
  await fs.writeFile(planPath, planText(fixture, storiesPath));
  await fs.writeFile(join(projectRoot, '.docs', 'stories', `${fixture.slug}.md`), storiesText(fixture));
  const positions = [...new Set(Object.values(fixture.sliceMembership.taskSlices))].sort((left, right) => left - right);
  await recordPositions(projectRoot, fixture.slug, positions);
}
