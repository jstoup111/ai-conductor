import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductState } from '../types/index.js';
import { resolveFeaturePlanPath, parseIntakeSourceRef, planStem } from './artifacts.js';
import { normalizeTasks } from './task-progress.js';
import { type GhRunner } from './owner-gate/identity.js';
import { type GitRunner } from './pr-labels.js';
import { executeGithubOperation, type GithubOperationEventEmitter, type GithubOperationRunner } from './github-operations.js';
import { postHaltHistoryComment, rehabilitateHaltPr, retitleFloor, bodyFloor, ensureShipReady } from './halt-pr-rehabilitation.js';
import { createShipDraftPublicationDependencies } from './ship-draft-pr.js';
import { extractRegionBytes, restoreRegion } from './pr-body-regions.js';
import { readRegionCaptures } from './pr-body-region-store.js';
import { RegionRestoreError } from './region-restore-error.js';
import { runTrackerUrlRead } from './tracker-client.js';

/**
 * Production-facing form of the existing FINISH presentation sequence.  The
 * coordinator calls this only after accepted prose is re-observed; the order
 * deliberately rehabilitates halt state and applies title/body floors before
 * making a draft mergeable.
 */
export function createFinishPresentationRepair(input: {
  projectRoot: string;
  gh: GhRunner;
  operations?: GithubOperationRunner;
  log?: (message: string) => void;
}): (request: { prUrl: string; state: ConductState; mode?: 'capture-only' | 'full' }) => Promise<void> {
  return async ({ prUrl, state, mode = 'full' }) => {
    const { projectRoot: cwd, gh } = input;
    const repairLog = input.log ?? console.warn;
    let sourceRef: string | undefined;
    try {
      const planPath = await resolveFeaturePlanPath(cwd, state.feature_desc);
      if (planPath && state.feature_desc) {
        sourceRef = parseIntakeSourceRef(await readFile(join(cwd, `.docs/intake/${planStem(planPath)}.md`), 'utf8').catch(() => null));
      }
    } catch { /* floors remain valid without an intake source reference */ }
    let testEvidenceLine: string | undefined;
    try {
      const tasks = normalizeTasks(JSON.parse(await readFile(join(cwd, '.pipeline/task-status.json'), 'utf8')));
      const completed = tasks.filter((task) => task.status === 'completed' || task.status === 'skipped').length;
      if (completed > 0) testEvidenceLine = `${completed}/${tasks.length} plan tasks completed with evidence-gated commits`;
    } catch { /* optional body evidence */ }
    try {
      const haltReason = await readFile(join(cwd, '.pipeline/halt-user-input-required'), 'utf8').catch(() => null);
      const outcome = await postHaltHistoryComment({
        gh, cwd, prUrl, haltReason, operations: input.operations, log: repairLog,
      });
      if (outcome === 'refused') {
        throw new Error('guarded halt-history repair refused');
      }
    } catch (error) { repairLog(`[conductor-repair] postHaltHistoryComment failed: ${error}`); throw error; }
    if (mode === 'capture-only') return;
    try {
      const outcome = await rehabilitateHaltPr({
        gh, cwd, prUrl, sourceRef, preserveDraft: true, operations: input.operations, log: repairLog,
      });
      if (outcome === 'refused') throw new Error('guarded halt rehabilitation refused');
    } catch (error) { repairLog(`[conductor-repair] rehabilitateHaltPr failed: ${error}`); throw error; }
    try {
      const outcome = await retitleFloor(gh, cwd, prUrl, { featureDesc: state.feature_desc, branch: state.worktree_branch, operations: input.operations }, repairLog);
      if (outcome.outcome === 'refused') throw new Error('guarded title repair refused');
    } catch (error) { repairLog(`[conductor-repair] retitleFloor failed: ${error}`); throw error; }
    try {
      const outcome = await bodyFloor(gh, cwd, prUrl, { featureDesc: state.feature_desc, sourceRef, testEvidenceLine, operations: input.operations }, repairLog);
      if (outcome === 'refused') throw new Error('guarded body repair refused');
    } catch (error) { repairLog(`[conductor-repair] bodyFloor failed: ${error}`); throw error; }
    // Regions captured from completed project-owned steps are authoritative
    // across every engine-owned presentation rewrite.
    const captures = await readRegionCaptures(cwd, prUrl);
    // A capture has no template bytes at this boundary; reconstruct the marker
    // wrapper from its key and preserve the captured interior exactly.
    // Every capture-present failure is a RegionRestoreError (ADR D6) so FINISH
    // fails closed instead of treating it as a lost response.
    if (Object.keys(captures).length > 0) try {
      let body: string;
      try {
        const stdout = await runTrackerUrlRead(gh, cwd, 'pull-request', prUrl, ['pr', 'view', prUrl, '--json', 'body']);
        const value = (JSON.parse(stdout) as { body?: unknown }).body;
        if (typeof value !== 'string') throw new Error('response has no string body');
        body = value;
      } catch (error) {
        throw new Error(`region verification read failed for ${Object.keys(captures).join(', ')}: ${error instanceof Error ? error.message : String(error)}`);
      }
      let next = body;
      for (const [key, bytes] of Object.entries(captures)) next = restoreRegion(next, { key, bytes });
      if (next !== body) {
        const target = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/.exec(prUrl);
        const keys = Object.entries(captures).filter(([key, bytes]) => extractRegionBytes(body, key) !== bytes).map(([key]) => key);
        if (!target || !input.operations) throw new Error(`guarded region restore unavailable for ${keys.join(', ') || 'unknown'}`);
        const result = await executeGithubOperation({ operation: 'pull-request.edit', repository: target[1], resource: { kind: 'pull-request', number: Number(target[2]) }, context: { actor: 'finish-region-restore' }, payload: { body: next } }, input.operations);
        if (result.kind !== 'executed') throw new RegionRestoreError('refused', keys, result.kind);
      }
      let verified: string;
      try {
        const stdout = await runTrackerUrlRead(gh, cwd, 'pull-request', prUrl, ['pr', 'view', prUrl, '--json', 'body']);
        const value = (JSON.parse(stdout) as { body?: unknown }).body;
        if (typeof value !== 'string') throw new Error('response has no string body');
        verified = value;
      } catch (error) {
        throw new Error(`region verification read failed for ${Object.keys(captures).join(', ')}: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const [key, bytes] of Object.entries(captures)) {
        if (extractRegionBytes(verified, key) !== bytes) throw new RegionRestoreError('mismatch', [key]);
      }
    } catch (error) {
      if (error instanceof RegionRestoreError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new RegionRestoreError('refused', Object.keys(captures), 'unavailable', `project-owned region restore failed: ${reason}`);
    }
    try {
      const outcome = await ensureShipReady(
        gh, cwd, prUrl, repairLog, undefined, input.operations,
      );
      if (outcome === 'refused') {
        throw new Error('guarded ready-for-review repair refused');
      }
    } catch (error) { repairLog(`[conductor-repair] ensureShipReady failed: ${error}`); throw error; }
  };
}

/**
 * Compose FINISH presentation repair at a live CLI root.  The guarded runner
 * is deliberately resolved for each repair attempt: its authorization reads
 * the current committed owner evidence when a mutation is requested, rather
 * than retaining a decision from coordinator construction.
 */
export function createProvenanceGuardedFinishPresentationRepair(input: {
  projectRoot: string;
  git: GitRunner;
  gh: GhRunner;
  baseBranch: string;
  log?: (message: string) => void;
  events?: GithubOperationEventEmitter;
}): (request: { prUrl: string; state: ConductState }) => Promise<void> {
  return async ({ prUrl, state }) => {
    const publication = await createShipDraftPublicationDependencies({
      cwd: input.projectRoot,
      branch: state.worktree_branch,
      baseBranch: input.baseBranch,
      featureDesc: state.feature_desc,
      prUrl,
      git: input.git,
      gh: input.gh,
      events: input.events,
    });
    if (!publication) {
      throw new Error('guarded finish presentation repair unavailable: committed feature provenance could not be resolved');
    }
    const pull = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/.exec(prUrl);
    if (!pull || pull[1].toLowerCase() !== publication.remoteMutation.provenance.repository.toLowerCase()) {
      throw new Error('guarded finish presentation repair unavailable: pull request target could not be resolved');
    }
    await createFinishPresentationRepair({
      projectRoot: input.projectRoot,
      gh: input.gh,
      operations: publication.operations,
      log: input.log,
    })({ prUrl, state });
  };
}
