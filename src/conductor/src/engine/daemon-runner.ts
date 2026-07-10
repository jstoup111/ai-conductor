import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import type { BacklogItem, FeatureOutcome } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import { emitEngineerSignal, resolveEngineerDir } from './engineer-store.js';
import {
  enrollWatch as enrollWatchImpl,
  sweepMergeableLabels as sweepMergeableLabelsImpl,
  type WatchEntry,
  type SweepOpts,
} from './mergeable-sweep.js';
import {
  prMergeState,
  removeLabel,
  setReady,
  cleanupHaltPresentation,
  makeProductionGh,
  type GhRunner,
} from './pr-labels.js';
import type { FinishChoice } from './artifacts.js';

/**
 * Outcome of running the gate loop inside a feature's worktree, read from the
 * `.pipeline/DONE` / `.pipeline/HALT` markers the conductor writes.
 */
export interface WorktreeOutcome {
  done: boolean;
  halted: boolean;
  reason?: string;
  prUrl?: string;
  costTokens?: number;
  /**
   * The finish skill's recorded outcome (from `.pipeline/finish-choice`),
   * when readable. `discard`/`keep` are no-ship outcomes even though the
   * gate-driven loop still converges (writes DONE) for them; /finish itself
   * skips the shipped-record commit for those choices (#204, #205).
   */
  finishChoice?: FinishChoice;
  /**
   * Task 13/16: triage evidence from setup-failure classification. Carries
   * outputTail, quarantineRef (if dirty tree was preserved), and contractOutcome
   * when a SetupFailureError is classified and parked.
   */
  triageEvidence?: TriageOutcome;
