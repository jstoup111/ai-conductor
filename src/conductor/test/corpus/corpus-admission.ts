import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from '../../src/engine/plan-task-parse.js';

export interface CorpusMeasurement {
  bytes: number;
  path: string;
}

export interface CorpusAdmissionEntry {
  dimension: string;
  measure: CorpusMeasurement;
  limit: number;
}

function repositoryRelativePath(directory: string, name: string): string {
  return relative(resolve(directory, '../..'), join(directory, name));
}

async function largestMeasurement(
  directory: string,
  names: readonly string[],
  measure: (name: string) => Promise<number>,
): Promise<CorpusMeasurement> {
  const sizes = await Promise.all(names.map(measure));
  const bytes = Math.max(...sizes);
  const largestIndex = sizes.indexOf(bytes);
  return {
    bytes,
    path: largestIndex === -1 ? '' : repositoryRelativePath(directory, names[largestIndex]),
  };
}

/** Measures recursive Markdown files exactly as the former corpus limit checks did. */
export async function largestMarkdownBytes(directory: string): Promise<CorpusMeasurement> {
  const names = (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.md'));
  return largestMeasurement(directory, names, async (name) => Buffer.byteLength(await readFile(join(directory, name), 'utf-8')));
}

/** Measures the first non-empty Technical Approach line in each recursive plan file. */
export async function largestPlanIntentBytes(directory: string): Promise<CorpusMeasurement> {
  const names = (await readdir(directory, { recursive: true })).filter((name) => name.endsWith('.md'));
  return largestMeasurement(directory, names, async (name) => {
    const plan = await readFile(join(directory, name), 'utf-8');
    const heading = /^##\s+Technical Approach\s*$/im.exec(plan);
    if (heading?.index === undefined) return 0;
    const section = plan.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? '';
    const intent = section.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    return Buffer.byteLength(intent, 'utf-8');
  });
}

/** Measures direct plan files' serialized task titles and Done-when checks exactly as remediation does. */
export async function largestPlanTasksBytes(directory: string): Promise<CorpusMeasurement> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.md'));
  return largestMeasurement(directory, names, async (name) => {
    const text = await readFile(join(directory, name), 'utf8');
    const titles = parsePlanTaskTitles(text);
    const doneWhen = parsePlanTaskDoneWhen(text);
    return Buffer.byteLength(JSON.stringify([...titles].map(([id, title]) => ({
      id, title, doneWhen: doneWhen.get(id) ?? [],
    }))), 'utf8');
  });
}

export function corpusAdmissionFailures(entries: readonly CorpusAdmissionEntry[]): string[] {
  return entries.flatMap(({ dimension, measure, limit }) => (
    measure.bytes > limit
      ? [`${dimension}: largest live input ${measure.path} is ${measure.bytes} B, over the shipped limit ${limit} B`]
      : []
  ));
}
