// Guard against raw `tsup` invocations against the live versioned engine
// layout. Kept in its own (shebang-free) module so it can be imported by
// `tsup.config.ts` directly — esbuild (which tsup uses to load its own
// config) chokes on parsing a module that starts with a `#!` shebang line,
// which `scripts/publish-engine.mjs` has (it's also a CLI entry point).
//
// See scripts/publish-engine.mjs (the wrapper that sets the marker env var
// on the real build subprocess it spawns) and tsup.config.ts (the consumer
// that calls `assertPublishWrapperEnv` before defining the build config).

/** Env var the wrapper sets on the tsup subprocess it spawns, so
 * `tsup.config.ts` can distinguish "invoked by the wrapper" from "invoked
 * directly by a human or script" (e.g. `npx tsup`). */
export const PUBLISH_WRAPPER_ENV_VAR = 'AI_CONDUCTOR_PUBLISH_WRAPPER';

/**
 * Throws an actionable error unless the wrapper marker env var is present.
 * @param {NodeJS.ProcessEnv} env
 */
export function assertPublishWrapperEnv(env) {
  if (!env[PUBLISH_WRAPPER_ENV_VAR]) {
    throw new Error(
      'Refusing to run tsup directly: the engine build now uses a versioned ' +
        'dist-versions/<id> + dist symlink layout that raw tsup output would ' +
        "clobber. Use `npm run build` instead of `tsup` directly.",
    );
  }
}
