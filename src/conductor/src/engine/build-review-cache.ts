import { join } from "node:path";

import type { BuildReviewRubricId } from "../types/config.js";
import {
  parseBuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewJudgedResult,
} from "./build-review-domain.js";

const CACHE_VERSION = 1;
const CACHE_DIRECTORY = ".pipeline/build-review/cache";

/** One bounded, feature-scoped reusable semantic judgement per rubric. */
export interface BuildReviewCacheEntry {
  version: typeof CACHE_VERSION;
  rubric: BuildReviewRubricId;
  contractVersion: "v1";
  projectionVersion: "v1";
  projectionDigest: string;
  policyFingerprint: string;
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
  contractVersion: "v1";
  projectionVersion: "v1";
  projectionDigest: string;
  policyFingerprint: string;
  lapId: BuildReviewLapId;
  snapshotDigest: string;
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
  | "policy-fingerprint-mismatch";

export type BuildReviewCacheLookupResolution =
  | { kind: "hit"; hit: BuildReviewCacheHit }
  | { kind: "miss"; reason: BuildReviewCacheMissReason };

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
  return value === "tautology" || value === "scope" || value === "rootCause" ||
    value === "completeness" || value === "wiring";
}

/** Strictly parses the cache boundary; unknown fields and non-judgements miss closed. */
export function parseBuildReviewCacheEntry(value: unknown): BuildReviewCacheEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const keys = [
    "version", "rubric", "contractVersion", "projectionVersion", "projectionDigest",
    "policyFingerprint", "result",
  ];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) {
    return undefined;
  }
  if (candidate.version !== CACHE_VERSION || !isRubric(candidate.rubric) ||
    candidate.contractVersion !== "v1" || candidate.projectionVersion !== "v1" ||
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
    contractVersion: candidate.contractVersion,
    projectionVersion: candidate.projectionVersion,
    projectionDigest: candidate.projectionDigest,
    policyFingerprint: candidate.policyFingerprint,
    result,
  };
}

/** Reads a cached semantic judgement, treating every read/parse error as a miss. */
export async function readBuildReviewCacheEntry(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  fs: BuildReviewCacheFilesystem,
): Promise<BuildReviewCacheEntry | undefined> {
  try {
    return parseBuildReviewCacheEntry(JSON.parse(await fs.readFile(cacheEntryPath(projectRoot, rubric))));
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
  const entry = parseBuildReviewCacheEntry(candidate);
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

/**
 * Returns a fresh current-lap semantic result only when every cache identity
 * field matches. Branch and aggregate artifacts never cross this boundary;
 * only the validated judgement payload and explicit provenance do.
 */
export function resolveBuildReviewCacheHit(
  entry: BuildReviewCacheEntry | undefined,
  lookup: BuildReviewCacheLookup,
): BuildReviewCacheHit | undefined {
  const resolution = classifyBuildReviewCacheLookup(entry, lookup);
  return resolution.kind === "hit" ? resolution.hit : undefined;
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
