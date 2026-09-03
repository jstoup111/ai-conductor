// Covers: task:4
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { parseAdrDecisions } from '../../src/engine/artifacts.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function decisionSection(content: string): string | null {
  const heading = content.match(/^##\s+Decision\s*$/im);
  if (heading?.index === undefined) return null;
  const remainder = content.slice(heading.index + heading[0].length);
  const nextHeading = remainder.search(/^##\s+/m);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

/**
 * Frozen AB-R12 predicate from resolveAsBuiltGoverningClause before it moves
 * to the shared parser. Keep this intentionally inlined so this test catches
 * future parser regressions rather than sharing the implementation under test.
 */
function legacyResolvableDecisionIds(section: string): Set<string> {
  const ids = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const numberedItem = line.match(/^\s*(\d+)\.\s+\S/);
    const dHeading = line.match(/^\s*#{0,6}\s*\*{0,2}D(\d+)\b/);
    const id = numberedItem?.[1] ?? dHeading?.[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

async function decisionMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return decisionMarkdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  }));
  return files.flat();
}

describe('ADR decision corpus compatibility', () => {
  it('retains every decision id resolvable by the frozen AB-R12 predicate', async () => {
    const decisionDirectory = join(REPOSITORY_ROOT, '.docs', 'decisions');
    const files = await decisionMarkdownFiles(decisionDirectory);

    expect(files).not.toHaveLength(0);

    for (const path of files) {
      const content = await readFile(path, 'utf8');
      const section = decisionSection(content);
      if (section === null) continue;

      const legacyIds = legacyResolvableDecisionIds(section);
      if (legacyIds.size === 0) continue;

      const parsed = parseAdrDecisions(content);
      const relativePath = relative(REPOSITORY_ROOT, path);
      if (parsed.kind !== 'decisions') {
        throw new Error(`${relativePath}: parser returned ${parsed.reason} for legacy-citable decisions.`);
      }
      for (const id of legacyIds) {
        expect(parsed.ids, `${relativePath}: legacy-resolvable decision id ${id} was lost.`).toContain(id);
      }
    }
  });
});
