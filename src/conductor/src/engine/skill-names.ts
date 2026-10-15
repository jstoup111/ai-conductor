import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

export interface SkillNameRootOptions {
  readonly isSelfHost: boolean;
  readonly worktreePath: string;
  readonly harnessRoot: string | null;
}

function frontmatterName(contents: string, skillPath: string): string | undefined {
  const opening = /^---\r?\n/.exec(contents);
  if (opening === null) return undefined;

  const remaining = contents.slice(opening[0].length);
  const closing = /(?:^|\n)---\r?(?:\n|$)/.exec(remaining);
  if (closing === null) {
    throw new Error(`Unclosed SKILL.md frontmatter at ${skillPath}`);
  }

  const parsed = loadYaml(remaining.slice(0, closing.index));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const name = (parsed as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}

/** Resolve a host-visible skill name from the tree used for its dispatch. */
export async function resolveSkillName(skillsRoot: string | null, directory: string): Promise<string> {
  if (skillsRoot === null) return directory;

  const skillPath = join(skillsRoot, 'skills', directory, 'SKILL.md');
  let contents: string;
  try {
    contents = readFileSync(skillPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read SKILL.md at ${skillPath}: ${String(error)}`);
  }

  return frontmatterName(contents, skillPath) ?? directory;
}

/** Select the skill tree whose names a dispatch must use. */
export function skillNameRootFor({
  isSelfHost,
  worktreePath,
  harnessRoot,
}: SkillNameRootOptions): string | null {
  return isSelfHost ? worktreePath : harnessRoot;
}
