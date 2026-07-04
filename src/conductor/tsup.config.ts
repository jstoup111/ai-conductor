import { defineConfig } from 'tsup';
import { assertPublishWrapperEnv } from './scripts/publish-guard.mjs';

// Refuse to run when invoked directly (e.g. `npx tsup`) instead of via
// `npm run build` -> scripts/publish-engine.mjs. Raw tsup output would
// clobber the versioned dist-versions/<id> + dist symlink layout. See
// Task 4 (FR-13 neg) / assertPublishWrapperEnv for details.
assertPublishWrapperEnv(process.env);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  sourcemap: true,
  shims: false,
});
