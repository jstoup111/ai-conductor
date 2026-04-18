import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Ensure the project has a `.claude/settings.json` with Read/Edit/Write
 * permissions scoped to the project root, so the bootstrap skill can actually
 * write its own artifacts (CLAUDE.md, .docs/, .memory/, .pipeline/…) without
 * every tool call hitting a permission prompt.
 *
 * Solves a chicken-and-egg problem: the bootstrap skill is supposed to create
 * `.claude/settings.json` in step 3d-i, but it can't do that if the project
 * has no permission rules yet and every `Write` is gated by the user. Running
 * this at conductor startup (before any Claude dispatch) breaks the loop.
 *
 * Idempotent — if `.claude/settings.json` already exists, do nothing. The
 * user's per-project customizations (and the bootstrap skill's own
 * generation when it runs on a fresh tree later) are preserved.
 *
 * The generated file uses the same shape as
 * `templates/claude-settings.json.template` so that consumers who re-bootstrap
 * an existing project land on the same config.
 */
export async function ensureClaudeSettings(projectRoot: string): Promise<void> {
  const claudeDir = join(projectRoot, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  try {
    await access(settingsPath);
    return;
  } catch {
    // File does not exist — proceed to create it.
  }

  await mkdir(claudeDir, { recursive: true });

  const contents = buildSettingsJson(projectRoot);
  await writeFile(settingsPath, contents, 'utf-8');
}

/**
 * Baseline Bash allow-list for harness operations. These are tools that the
 * skills invoke on essentially every project type — denying them would force
 * a permission prompt on nearly every step, which is the exact noise the
 * preflight exists to avoid.
 *
 * Stack-specific tooling (bundle/rails/rake for Ruby, pytest/pip for Python,
 * cargo for Rust, go, etc.) is NOT included here — those belong in the
 * bootstrap step's stack-detection output, so projects that don't use them
 * don't carry dead allow rules. Anything a user's skill needs beyond this
 * list can be appended to `.claude/settings.json` or (for machine-specific
 * overrides) `.claude/settings.local.json`.
 */
const BASELINE_BASH_ALLOWS: readonly string[] = [
  'Bash(git:*)',
  'Bash(gh:*)',
  'Bash(rtk:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(node:*)',
  'Bash(mkdir:*)',
  'Bash(touch:*)',
  'Bash(chmod:*)',
  'Bash(ln:*)',
  'Bash(glow:*)',
];

export function buildSettingsJson(projectRoot: string): string {
  const scope = projectRoot.startsWith('/') ? projectRoot.slice(1) : projectRoot;
  const payload = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: {
      allow: [
        `Read(//${scope}/**)`,
        `Edit(//${scope}/**)`,
        `Write(//${scope}/**)`,
        ...BASELINE_BASH_ALLOWS,
      ],
    },
  };
  return JSON.stringify(payload, null, 2) + '\n';
}
