import { ensureGitGuardForDispatch } from '../../src/engine/git-guard.js';

/** Real engine implementation for provider construction outside port-specific tests. */
export const dispatchGitGuard = ensureGitGuardForDispatch;
