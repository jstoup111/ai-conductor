import { readdir, readFile, access } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { BacklogItem } from './daemon.js';

/**
 * Discover daemon-eligible features (Phase 6). The daemon consumes existing,
 * human-authored specs — it never authors them — so a feature is eligible only
 * when BOTH its stories and plan artifacts are present.
 *
 * Source of truth is `.docs/plans/*.md`: each plan names its stories file via a
 * `**Stories:** <path>` line (repo convention). The slug is the plan filename
 * stem. A feature already marked processed (via `isProcessed`) is skipped so the
 * daemon doesn't re-run shipped work.
 */
export async function discoverBacklog(
  projectRoot: string,
  isProcessed: (slug: string) => Promise<boolean> = async () => false,
): Promise<BacklogItem[]> {
  const plansDir = join(projectRoot, '.docs/plans');
  let planFiles: string[];
  try {
    planFiles = (await readdir(plansDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // no plans dir → nothing to do
  }

  const items: BacklogItem[] = [];
  for (const file of planFiles.sort()) {
    const planPath = join(plansDir, file);
    const slug = basename(file, '.md');

    const storiesPath = await resolveStoriesPath(projectRoot, planPath);
    if (!storiesPath) continue; // no stories → not eligible (daemon doesn't author them)

    if (await isProcessed(slug)) continue;

    items.push({ slug, storiesPath, planPath });
  }
  return items;
}

/**
 * Resolve the stories file a plan depends on. Prefers the explicit
 * `**Stories:** <path>` line; falls back to a stories file whose stem matches
 * the plan's. Returns null if no existing stories file is found.
 */
async function resolveStoriesPath(
  projectRoot: string,
  planPath: string,
): Promise<string | null> {
  let content = '';
  try {
    content = await readFile(planPath, 'utf-8');
  } catch {
    return null;
  }

  const m = content.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m) {
    const ref = m[1];
    const abs = isAbsolute(ref) ? ref : resolve(projectRoot, ref);
    if (await fileExists(abs)) return abs;
  }

  // Fallback: a stories file with the same stem as the plan.
  const stem = basename(planPath, '.md');
  const candidate = join(projectRoot, '.docs/stories', `${stem}.md`);
  if (await fileExists(candidate)) return candidate;

  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
