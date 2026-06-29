// Global vitest setup — runs before every test file.
//
// Never spawn a REAL build daemon during the suite. The engineer handoff's
// `ensureRunning` funnels (when no launch is injected) into `launchDaemon`, which
// under ADR-014 would otherwise run `tmux new-session -d 'conduct-ts daemon
// --continuous'` and leak a real daemon that outlives the test's tmpdir. The
// kill-switch makes that default (non-injected) launch a no-op; tests that inject a
// supervisor / launch spy still exercise their delegation contract unchanged.
import { NO_AUTOLAUNCH_ENV } from '../src/engine/engineer/daemon-launch.js';

process.env[NO_AUTOLAUNCH_ENV] = '1';
