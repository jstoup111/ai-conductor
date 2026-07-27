// test/engine/build-auth-status-cli-config-wiring.test.ts
//
// Regression test for the 2026-07-26 daemon self-host incident
// (2026-07-26-daemon-decide-phase-coherence-ownership-971): `conduct
// build-auth-status` reported `mode=daemon-token state=valid` while the SAME
// process's real self-host build dispatch (conductor.ts's
// resolveSelfHostConfig(this.config), fed by loadMergedConfig — project
// .ai-conductor/config.yml deep-merged over ~/.ai-conductor/config.yml) had
// actually resolved `buildAuthMode: 'api-key'` (a stale
// harness_self_host.build_auth.mode: api-key left in the operator's
// ~/.ai-conductor/config.yml, deep-merged in because the project config's
// harness_self_host block doesn't override build_auth) and halted with
// "Auth failure in api-key mode".
//
// Root cause: `index.ts`'s build-auth-status dispatch site called
// `dispatchBuildAuthStatus(cmd)` with NO `config` in its deps, so
// `resolveSelfHostConfig(undefined)` always resolved the hardcoded default
// (daemon-token) — completely blind to the project + user config that
// governs the actual dispatch. The CLI diagnostic gave a false all-clear.
//
// Mirrors the source-grep composition-root technique used by
// `daemon-cli-build-auth-wiring.test.ts` for the exact same class of bug
// (a well-tested primitive with zero production wiring) — this file proves
// index.ts's dispatch site, not just dispatchBuildAuthStatus in isolation.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CLI_SRC = join(__dirname, '../../src/index.ts');

describe('build-auth-status CLI dispatch loads the real merged config', () => {
  it('loads the merged config (loadMergedConfig) before dispatching build-auth-status', async () => {
    const source = await readFile(INDEX_CLI_SRC, 'utf-8');

    const dispatchBlockMatch = source.match(
      /const buildAuthStatusCmd[\s\S]{0,1500}?process\.exit\(code\);\s*\n\s*\}/,
    );
    expect(
      dispatchBlockMatch,
      'expected a build-auth-status dispatch block in index.ts',
    ).toBeTruthy();
    const block = dispatchBlockMatch![0];

    // The block must actually resolve the merged config on disk (project +
    // user), not rely on the dispatcher's own undefined default.
    expect(block).toMatch(/loadMergedConfig\s*\(/);
  });

  it('passes the loaded config into dispatchBuildAuthStatus — never dispatches with an empty deps object', async () => {
    const source = await readFile(INDEX_CLI_SRC, 'utf-8');

    const dispatchCallMatch = source.match(/dispatchBuildAuthStatus\s*\(\s*buildAuthStatusCmd\s*,\s*\{[^}]*\}\s*\)/);
    expect(
      dispatchCallMatch,
      'expected dispatchBuildAuthStatus to be called with a config-bearing deps object',
    ).toBeTruthy();
    expect(dispatchCallMatch![0]).toMatch(/config\s*:/);

    // The exact regression: `dispatchBuildAuthStatus(buildAuthStatusCmd)` with
    // no second argument at all silently resolves against `undefined` config.
    expect(source).not.toMatch(/dispatchBuildAuthStatus\s*\(\s*buildAuthStatusCmd\s*\)\s*;/);
  });
});
