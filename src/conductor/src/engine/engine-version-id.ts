// Engine version-id grammar — the `<YYYYMMDDTHHMMSSZ>-<12 hex>` identity that
// names one published engine build (`dist-versions/<id>/`).
//
// This module is deliberately a LEAF: it imports nothing, not even from
// `node:`. It exists because the grammar has three consumers that must not be
// coupled to each other:
//
//   - `engine-store.ts`   — publishes, lists, and GCs versions (imports
//                           `registry.ts` and `daemon-lock.ts`);
//   - `daemon-lock.ts`    — stamps the running build into its pidfile (imported
//                           BY `engine-store.ts`);
//   - `shipped-record.ts` — stamps the running build into a shipped record.
//
// Before this module, `daemon-lock.ts` imported the grammar from
// `engine-store.ts` while `engine-store.ts` imported `getPidfilePath` from
// `daemon-lock.ts` — a genuine ESM import cycle whose binding initialization
// order depended on which module the entry point reached first. Keeping the
// grammar here removes that cycle, and keeps a pure render/parse module like
// `shipped-record.ts` from transitively pulling in the project registry and the
// daemon pidfile lock just to read a path segment.

/**
 * A validated engine version id. Branded so a bare string cannot be passed
 * where a checked id is required.
 */
export type EngineVersionId = string & { readonly __brand: 'EngineVersionId' };

/** Format: `<YYYYMMDDTHHMMSSZ>-<12 hex chars of content hash>`. */
const VERSION_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;

export function isEngineVersionId(name: string): name is EngineVersionId {
  return VERSION_ID_PATTERN.test(name);
}

/**
 * Extract the `EngineVersionId` path segment embedded in an engine directory
 * (e.g. `.../dist-versions/<id>/engine`), or `undefined` if no segment matches
 * the version-id format (e.g. a dev/unpublished `src/engine` run, which
 * references no published version).
 *
 * Pure string inspection — never touches the filesystem, so a dangling or
 * garbage-collected directory never errors here.
 */
export function versionIdFromEngineDir(engineDir: string): EngineVersionId | undefined {
  const segments = engineDir.split(/[\\/]/);
  const match = segments.find((segment) => isEngineVersionId(segment));
  return match as EngineVersionId | undefined;
}
