import { mkdir, readFile, rename as renameFile, unlink as unlinkFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  appendRemediationTasks as appendCriterionBoundRemediationTasks,
  buildRemediationDoneWhenChecks,
  type CriterionBoundRemediationGap,
} from './remediation-append.js';

/**
 * Task 19: Append remediation tasks to the plan file with validation.
 *
 * Validates that all remediation task IDs are non-empty and match TASK_ID_PATTERN,
 * then appends them to the plan file. Gate-source prefix is expected but not required.
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file to append to
 * @param remediationList - List of remediation tasks with id and title
 * @param options - Optional logger function
 * @returns { success: true } on success, { success: false, error: string } on failure
 */
export async function appendConductorRemediationTasks(
  projectRoot: string,
  planPath: string,
  remediationList: Array<{ id: string; title: string }>,
  options?: {
    log?: (msg: string) => void;
    criterionBoundGaps?: CriterionBoundRemediationGap[];
    gateSource?: string;
  },
): Promise<{ success: true; appendedIds: string[] } | { success: false; error: string }> {
  const log = options?.log ?? (() => {});

  // TASK_ID_PATTERN from autoheal.ts: [A-Za-z0-9._-]+
  const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';
  const taskIdRegex = new RegExp(`^${TASK_ID_PATTERN}$`);

  // Validate all task IDs before appending anything
  for (const task of remediationList) {
    // Check for empty ID
    if (!task.id || task.id.trim() === '') {
      return {
        success: false,
        error: `Task ID must be non-empty, but got empty string for title: "${task.title}"`,
      };
    }

    // Check if ID matches pattern
    if (!taskIdRegex.test(task.id)) {
      return {
        success: false,
        error: `Task ID "${task.id}" does not match TASK_ID_PATTERN [A-Za-z0-9._-]+`,
      };
    }

    // Warn if gate-source prefix is missing (rem-fr10-*, rem-adr-*, rem-test-*, etc.)
    if (!task.id.startsWith('rem-')) {
      log(`Warning: Task ID "${task.id}" missing gate-source prefix (expected rem-*)`);
    }
  }

  // Read existing plan content
  let planContent = '';
  try {
    planContent = await readFile(planPath, 'utf-8');
  } catch {
    // If plan file doesn't exist, start with empty content
    planContent = '';
  }

  if (options?.criterionBoundGaps !== undefined && options.gateSource !== undefined) {
    const rendered = appendCriterionBoundRemediationTasks(
      planContent,
      options.criterionBoundGaps,
      options.gateSource,
    );
    const pipelineDir = join(projectRoot, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const tempFile = `${planPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await writeFile(tempFile, rendered.planText, 'utf-8');
      await renameFile(tempFile, planPath);
    } catch (error) {
      await unlinkFile(tempFile).catch(() => {});
      return {
        success: false,
        error: `Failed to append remediation tasks to plan: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
    return { success: true, appendedIds: rendered.ids };
  }

  // Parse existing task headers to detect duplicates and content drift
  // Regex: ### Task <id>: <title>
  const taskHeaderRegex = /^### Task ([A-Za-z0-9._-]+(?:-[a-f0-9]{6})?(?:-\d+)?): (.+)$/gm;
  const existingTasks = new Map<string, { title: string; fullHeader: string }>();
  let match;
  while ((match = taskHeaderRegex.exec(planContent)) !== null) {
    const taskId = match[1];
    const taskTitle = match[2];
    const fullHeader = match[0];
    existingTasks.set(taskId, { title: taskTitle, fullHeader });
  }

  // Determine which tasks to append (idempotent upsert semantics)
  const tasksToAppend: Array<{ id: string; title: string; finalId: string }> = [];
  // Every requested task's id AS IT EXISTS IN THE PLAN after this call —
  // whether newly appended, hash-suffixed, or already present. Callers
  // record these so the build completion predicate can reject a later
  // removal of the heading from the plan.
  const appendedIds: string[] = [];

  for (const task of remediationList) {
    const existing = existingTasks.get(task.id);

    if (existing) {
      // Task ID already exists
      if (existing.title === task.title) {
        // Same ID, same content → idempotent, skip
        log(`Task ${task.id} already exists with same content, skipping`);
        appendedIds.push(task.id);
        continue;
      } else {
        // Same ID, different content → create content-hash suffix to distinguish
        const { createHash } = await import('crypto');
        const contentHash = createHash('sha256')
          .update(task.title)
          .digest('hex')
          .slice(0, 6);

        const suffixedId = `${task.id}-${contentHash}`;

        // Check if the suffixed ID already exists
        if (existingTasks.has(suffixedId)) {
          log(`Task ${suffixedId} already exists with same content, skipping`);
          appendedIds.push(suffixedId);
          continue;
        }

        log(
          `Task ${task.id} exists with different content, using suffix: ${suffixedId}`,
        );
        tasksToAppend.push({ id: task.id, title: task.title, finalId: suffixedId });
        appendedIds.push(suffixedId);
      }
    } else {
      // New task ID, append as-is
      tasksToAppend.push({ id: task.id, title: task.title, finalId: task.id });
      appendedIds.push(task.id);
    }
  }

  // Append tasks that don't have duplicates
  let updated = planContent;
  if (tasksToAppend.length > 0 && updated !== '' && !updated.endsWith('\n')) {
    updated += '\n\n';
  }
  for (const task of tasksToAppend) {
    const checks = buildRemediationDoneWhenChecks(
      task.finalId,
      'remediation',
      undefined,
      undefined,
      undefined,
      task.title,
    );
    updated += [
      `### Task ${task.finalId}: ${task.title}`,
      '**Done when:**',
      ...checks.map((check) => `- ${check}`),
      '',
    ].join('\n');
  }

  // Write plan atomically using temp file + rename pattern
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  const tempFile = `${planPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempFile, updated, 'utf-8');
    // Rename temp file to target (atomic on most filesystems).
    // MUST stay a static import: a dynamic `require` here is rewritten by
    // esbuild into a shim that throws in the shipped pure-ESM bundle, and the
    // catch below would swallow it into a silent remediation no-op.
    await renameFile(tempFile, planPath);
  } catch (error) {
    // Clean up temp file if something went wrong
    try {
      await unlinkFile(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    return {
      success: false,
      error: `Failed to append remediation tasks to plan: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  return { success: true, appendedIds };
}
