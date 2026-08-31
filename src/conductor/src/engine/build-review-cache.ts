import { join } from "node:path";

import type { BuildReviewRubricId } from "../types/config.js";
import {
  parseBuildReviewRubricContractVersion,
  parseBuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewJudgedResult,
  type BuildReviewRubricContractVersion,
} from "./build-review-domain.js";
import { isRetiredBuildReviewRubric } from './build-review-dispositions.js';

const CACHE_VERSION = 1;
const CACHE_DIRECTORY = ".pipeline/build-review/cache";

/**
 * The judging engine's identity (adr-2026-08-21 D1): a sixth, sibling cache
 * identity component alongside (never inside) `policyFingerprint`.
 * `engineStamp` is the 12-hex content stamp only (or the `dev` sentinel);
 * `skillDigest` is `sha256:` over the raw bytes of the rubric's installed
 * SKILL.md.
 */
export interface BuildReviewEngineIdentity {
  engineStamp: string;
  skillDigest: string;
}

/** One bounded, feature-scoped reusable semantic judgement per rubric. */
export interface BuildReviewCacheEntry {
  version: typeof CACHE_VERSION;
  rubric: BuildReviewRubricId;
  contractVersion: "v3";
  projectionVersion: "v2";
  projectionDigest: string;
  policyFingerprint: string;
  engineIdentity: BuildReviewEngineIdentity;
  result: BuildReviewJudgedResult;
}

/** Injected so cache tests never touch the host filesystem. */
export interface BuildReviewCacheFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** The complete identity that must match before a semantic cache entry is reusable. */
export interface BuildReviewCacheLookup {
  rubric: BuildReviewRubricId;
  contractVersion: "v3";
  projectionVersion: "v2";
  projectionDigest: string;
  policyFingerprint: string;
  engineIdentity: BuildReviewEngineIdentity;
  lapId: BuildReviewLapId;
  snapshotDigest: string;
}

/** Safely parsed persisted state, including legacy entries that must miss closed. */
export interface BuildReviewCacheEntryCandidate extends Omit<BuildReviewCacheEntry, "contractVersion" | "projectionVersion" | "engineIdentity"> {
  contractVersion: BuildReviewRubricContractVersion;
  projectionVersion: "v1" | "v2";
  /**
   * Staged legacy parse (adr-2026-08-21 D4): pre-engine-identity entries carry
   * no field and classify as `engine-version-mismatch`, never `invalid-entry`.
   * Newly written entries always carry it.
   */
  engineIdentity?: BuildReviewEngineIdentity;
}

/** Explicit cache provenance accompanies a newly materialized current-lap result. */
export interface BuildReviewCacheHit {
  result: BuildReviewJudgedResult;
  provenance: {
    kind: "cache-hit";
    cachedLapId: BuildReviewLapId;
    cachedSnapshotDigest: string;
    projectionDigest: string;
    policyFingerprint: string;
  };
}

export type BuildReviewCacheMissReason =
  | "missing"
  | "invalid-entry"
  | "rubric-mismatch"
  | "contract-version-mismatch"
  | "projection-version-mismatch"
  | "projection-digest-mismatch"
  | "policy-fingerprint-mismatch"
  | "engine-version-mismatch"
  | "skill-digest-mismatch";

export type BuildReviewCacheLookupResolution =
  | { kind: "hit"; hit: BuildReviewCacheHit }
  | {
      kind: "miss";
      reason: BuildReviewCacheMissReason;
      /** The stamp a discarded engine-identity entry was judged under, when it carried one. */
      cachedEngineStamp?: string;
    };

export function cacheEntryPath(projectRoot: string, rubric: BuildReviewRubricId): string {
  return join(projectRoot, CACHE_DIRECTORY, `${rubric}.json`);
}

function cacheDirectory(projectRoot: string): string {
  return join(projectRoot, CACHE_DIRECTORY);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRubric(value: unknown): value is BuildReviewRubricId {
  return value === "testQuality";
}

function parseBuildReviewEngineIdentity(value: unknown): BuildReviewEngineIdentity | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 &&
    isNonEmptyString(candidate.engineStamp) && isNonEmptyString(candidate.skillDigest)
    ? { engineStamp: candidate.engineStamp, skillDigest: candidate.skillDigest }
    : undefined;
}

/** Strictly parses the cache boundary; unknown fields and non-judgements miss closed. */
function parseBuildReviewCacheEntryCandidate(value: unknown): BuildReviewCacheEntryCandidate | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const keys = [
    "version", "rubric", "contractVersion", "projectionVersion", "projectionDigest",
    "policyFingerprint", "result", ...(candidate.engineIdentity === undefined ? [] : ["engineIdentity"]),
  ];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) {
    return undefined;
  }
  const engineIdentity = candidate.engineIdentity === undefined
    ? undefined
    : parseBuildReviewEngineIdentity(candidate.engineIdentity);
  if (candidate.engineIdentity !== undefined && !engineIdentity) return undefined;
  const contractVersion = parseBuildReviewRubricContractVersion(candidate.contractVersion);
  if (candidate.version !== CACHE_VERSION || !isRubric(candidate.rubric) || !contractVersion ||
    (candidate.projectionVersion !== "v1" && candidate.projectionVersion !== "v2") ||
    !isNonEmptyString(candidate.projectionDigest) || !isNonEmptyString(candidate.policyFingerprint)) {
    return undefined;
  }
  const result = parseBuildReviewJudgedResult(candidate.result);
  if (!result || result.rubric !== candidate.rubric || result.contractVersion !== candidate.contractVersion) {
    return undefined;
  }
  return {
    version: CACHE_VERSION,
    rubric: candidate.rubric,
    contractVersion,
    projectionVersion: candidate.projectionVersion,
    projectionDigest: candidate.projectionDigest,
    policyFingerprint: candidate.policyFingerprint,
    ...(engineIdentity === undefined ? {} : { engineIdentity }),
    result,
  };
}

/** Strictly parses entries current code may persist or reuse. */
export function parseBuildReviewCacheEntry(value: unknown): BuildReviewCacheEntry | undefined {
  const entry = parseBuildReviewCacheEntryCandidate(value);
  return entry?.contractVersion === "v3" && entry.projectionVersion === "v2" && entry.engineIdentity !== undefined
    ? { ...entry, contractVersion: "v3", projectionVersion: "v2", engineIdentity: entry.engineIdentity }
    : undefined;
}

/** Reads a cached semantic judgement, treating every read/parse error as a miss. */
export async function readBuildReviewCacheEntry(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  fs: BuildReviewCacheFilesystem,
): Promise<BuildReviewCacheEntryCandidate | undefined> {
  try {
    const entry = parseBuildReviewCacheEntryCandidate(JSON.parse(await fs.readFile(cacheEntryPath(projectRoot, rubric))));
    return entry && !isRetiredBuildReviewRubric(entry.rubric) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classifies the cache boundary exhaustively. Invalid values are never
 * normalized or rewritten: callers receive a miss and must run a fresh
 * judgement before replacing the bounded entry.
 */
export function classifyBuildReviewCacheLookup(
  candidate: unknown,
  lookup: BuildReviewCacheLookup,
): BuildReviewCacheLookupResolution {
  if (candidate === undefined) return { kind: "miss", reason: "missing" };
  const entry = parseBuildReviewCacheEntryCandidate(candidate);
  if (!entry) return { kind: "miss", reason: "invalid-entry" };
  if (entry.rubric !== lookup.rubric) return { kind: "miss", reason: "rubric-mismatch" };
  if (entry.contractVersion !== lookup.contractVersion) {
    return { kind: "miss", reason: "contract-version-mismatch" };
  }
  if (entry.projectionVersion !== lookup.projectionVersion) {
    return { kind: "miss", reason: "projection-version-mismatch" };
  }
  if (entry.projectionDigest !== lookup.projectionDigest) {
    return { kind: "miss", reason: "projection-digest-mismatch" };
  }
  if (entry.policyFingerprint !== lookup.policyFingerprint) {
    return { kind: "miss", reason: "policy-fingerprint-mismatch" };
  }
  if (entry.engineIdentity?.engineStamp !== lookup.engineIdentity.engineStamp) {
    return {
      kind: "miss",
      reason: "engine-version-mismatch",
      ...(entry.engineIdentity === undefined ? {} : { cachedEngineStamp: entry.engineIdentity.engineStamp }),
    };
  }
  if (entry.engineIdentity.skillDigest !== lookup.engineIdentity.skillDigest) {
    return { kind: "miss", reason: "skill-digest-mismatch", cachedEngineStamp: entry.engineIdentity.engineStamp };
  }
  return {
    kind: "hit",
    hit: {
      result: {
        ...entry.result,
        lapId: lookup.lapId,
        snapshotDigest: lookup.snapshotDigest,
      },
      provenance: {
        kind: "cache-hit",
        cachedLapId: entry.result.lapId,
        cachedSnapshotDigest: entry.result.snapshotDigest,
        projectionDigest: entry.projectionDigest,
        policyFingerprint: entry.policyFingerprint,
      },
    },
  };
}

/** Atomically replaces the rubric's single bounded entry after validating it. */
export async function writeBuildReviewCacheEntry(
  projectRoot: string,
  entry: BuildReviewCacheEntry,
  fs: BuildReviewCacheFilesystem,
): Promise<void> {
  if (!parseBuildReviewCacheEntry(entry)) {
    throw new Error("build-review cache: entry must contain a valid judged result");
  }
  const path = cacheEntryPath(projectRoot, entry.rubric);
  await fs.mkdir(cacheDirectory(projectRoot));
  await fs.writeFile(`${path}.tmp`, JSON.stringify(entry));
  await fs.rename(`${path}.tmp`, path);
}
