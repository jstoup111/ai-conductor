import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import type { BuildReviewRubricId } from "../types/config.js";
import {
  parseBuildReviewRubricContractVersion,
  parseBuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewJudgedResult,
  type BuildReviewRubricContractVersion,
} from "./build-review-domain.js";
import { isRetiredBuildReviewRubric } from './build-review-dispositions.js';

const LEGACY_CACHE_VERSION = 1;
const CACHE_VERSION = 2;
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

/**
 * Complete path-free eligibility identity for one actual prepared candidate.
 * Producing provenance stays outside this value so a judgment can be reused
 * and rematerialized for a later lap.
 */
export interface BuildReviewCacheSemanticIdentity {
  declarationFingerprint: string;
  effectiveBundleDigest: string;
  contractVersion: BuildReviewRubricContractVersion;
  projectionVersion: "v1" | "v2" | "v3";
  semanticInputDigest: string;
  executionPolicyFingerprint: string;
  engineStamp: string;
  provider: string;
  model: string;
  effort: string;
}

/**
 * One reusable semantic judgement. Version-one entries remain readable only
 * for staged misses; writers create version-two, candidate-partitioned entries.
 */
export interface BuildReviewCacheEntry {
  version: typeof LEGACY_CACHE_VERSION | typeof CACHE_VERSION;
  rubric: BuildReviewRubricId;
  contractVersion: "v3";
  projectionVersion: "v3";
  projectionDigest: string;
  policyFingerprint: string;
  engineIdentity: BuildReviewEngineIdentity;
  /** Candidate-bound identity; absent only on legacy/incomplete entries. */
  semanticIdentity?: BuildReviewCacheSemanticIdentity;
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
  projectionVersion: "v3";
  projectionDigest: string;
  policyFingerprint: string;
  engineIdentity: BuildReviewEngineIdentity;
  /** Candidate-bound identity; old callers retain their established lookup. */
  semanticIdentity?: BuildReviewCacheSemanticIdentity;
  lapId: BuildReviewLapId;
  snapshotDigest: string;
}

/** Safely parsed persisted state, including legacy entries that must miss closed. */
export interface BuildReviewCacheEntryCandidate extends Omit<BuildReviewCacheEntry, "contractVersion" | "projectionVersion" | "engineIdentity"> {
  contractVersion: BuildReviewRubricContractVersion;
  projectionVersion: "v1" | "v2" | "v3";
  /**
   * Staged legacy parse (adr-2026-08-21 D4): pre-engine-identity entries carry
   * no field and classify as `engine-version-mismatch`, never `invalid-entry`.
   * Newly written entries always carry it.
   */
  engineIdentity?: BuildReviewEngineIdentity;
  semanticIdentity?: BuildReviewCacheSemanticIdentity;
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
  | "semantic-identity-missing"
  | "declaration-fingerprint-mismatch"
  | "effective-bundle-digest-mismatch"
  | "semantic-input-digest-mismatch"
  | "execution-policy-fingerprint-mismatch"
  | "engine-content-stamp-mismatch"
  | "provider-mismatch"
  | "model-mismatch"
  | "effort-mismatch"
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

function cacheCandidateIdentityKey(identity: BuildReviewCacheSemanticIdentity): string {
  return createHash("sha256").update(JSON.stringify({
    declarationFingerprint: identity.declarationFingerprint,
    effectiveBundleDigest: identity.effectiveBundleDigest,
    contractVersion: identity.contractVersion,
    projectionVersion: identity.projectionVersion,
    semanticInputDigest: identity.semanticInputDigest,
    executionPolicyFingerprint: identity.executionPolicyFingerprint,
    engineStamp: identity.engineStamp,
    provider: identity.provider,
    model: identity.model,
    effort: identity.effort,
  })).digest("hex");
}

/**
 * Current entries are partitioned by the complete, path-free candidate
 * identity. The two-argument legacy location remains readable during the
 * staged migration but is never a target for a new write.
 */
export function cacheEntryPath(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  semanticIdentity?: BuildReviewCacheSemanticIdentity,
): string {
  const directory = join(projectRoot, CACHE_DIRECTORY);
  return semanticIdentity === undefined
    ? join(directory, `${rubric}.json`)
    : join(directory, rubric, `${cacheCandidateIdentityKey(semanticIdentity)}.json`);
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

function parseBuildReviewCacheSemanticIdentity(value: unknown): BuildReviewCacheSemanticIdentity | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const keys = [
    "declarationFingerprint", "effectiveBundleDigest", "contractVersion", "projectionVersion",
    "semanticInputDigest", "executionPolicyFingerprint", "engineStamp", "provider", "model", "effort",
  ];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) {
    return undefined;
  }
  const contractVersion = parseBuildReviewRubricContractVersion(candidate.contractVersion);
  if (!contractVersion || (candidate.projectionVersion !== "v1" && candidate.projectionVersion !== "v2" && candidate.projectionVersion !== "v3")) {
    return undefined;
  }
  if (!keys.filter((key) => key !== "contractVersion" && key !== "projectionVersion")
    .every((key) => isNonEmptyString(candidate[key]))) return undefined;
  return {
    declarationFingerprint: candidate.declarationFingerprint as string,
    effectiveBundleDigest: candidate.effectiveBundleDigest as string,
    contractVersion,
    projectionVersion: candidate.projectionVersion,
    semanticInputDigest: candidate.semanticInputDigest as string,
    executionPolicyFingerprint: candidate.executionPolicyFingerprint as string,
    engineStamp: candidate.engineStamp as string,
    provider: candidate.provider as string,
    model: candidate.model as string,
    effort: candidate.effort as string,
  };
}

/** Strictly parses the cache boundary; unknown fields and non-judgements miss closed. */
function parseBuildReviewCacheEntryCandidate(value: unknown): BuildReviewCacheEntryCandidate | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const keys = [
    "version", "rubric", "contractVersion", "projectionVersion", "projectionDigest",
    "policyFingerprint", "result", ...(candidate.engineIdentity === undefined ? [] : ["engineIdentity"]),
    ...(candidate.semanticIdentity === undefined ? [] : ["semanticIdentity"]),
  ];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) {
    return undefined;
  }
  const engineIdentity = candidate.engineIdentity === undefined
    ? undefined
    : parseBuildReviewEngineIdentity(candidate.engineIdentity);
  if (candidate.engineIdentity !== undefined && !engineIdentity) return undefined;
  const semanticIdentity = candidate.semanticIdentity === undefined
    ? undefined
    : parseBuildReviewCacheSemanticIdentity(candidate.semanticIdentity);
  if (candidate.semanticIdentity !== undefined && !semanticIdentity) return undefined;
  const contractVersion = parseBuildReviewRubricContractVersion(candidate.contractVersion);
  if ((candidate.version !== LEGACY_CACHE_VERSION && candidate.version !== CACHE_VERSION) || !isRubric(candidate.rubric) || !contractVersion ||
    (candidate.projectionVersion !== "v1" && candidate.projectionVersion !== "v2" && candidate.projectionVersion !== "v3") ||
    !isNonEmptyString(candidate.projectionDigest) || !isNonEmptyString(candidate.policyFingerprint)) {
    return undefined;
  }
  const result = parseBuildReviewJudgedResult(candidate.result);
  if (!result || result.rubric !== candidate.rubric || result.contractVersion !== candidate.contractVersion) {
    return undefined;
  }
  return {
    version: candidate.version,
    rubric: candidate.rubric,
    contractVersion,
    projectionVersion: candidate.projectionVersion,
    projectionDigest: candidate.projectionDigest,
    policyFingerprint: candidate.policyFingerprint,
    ...(engineIdentity === undefined ? {} : { engineIdentity }),
    ...(semanticIdentity === undefined ? {} : { semanticIdentity }),
    result,
  };
}

/** Strictly parses entries current code may persist or reuse. */
export function parseBuildReviewCacheEntry(value: unknown): BuildReviewCacheEntry | undefined {
  const entry = parseBuildReviewCacheEntryCandidate(value);
  return entry?.version === CACHE_VERSION && entry.contractVersion === "v3" && entry.projectionVersion === "v3" &&
    entry.engineIdentity !== undefined && entry.semanticIdentity !== undefined
    ? {
        ...entry,
        version: CACHE_VERSION,
        contractVersion: "v3",
        projectionVersion: "v3",
        engineIdentity: entry.engineIdentity,
        semanticIdentity: entry.semanticIdentity,
      }
    : undefined;
}

/** Reads a cached semantic judgement, treating every read/parse error as a miss. */
export async function readBuildReviewCacheEntry(
  projectRoot: string,
  rubric: BuildReviewRubricId,
  fs: BuildReviewCacheFilesystem,
  semanticIdentity?: BuildReviewCacheSemanticIdentity,
): Promise<BuildReviewCacheEntryCandidate | undefined> {
  try {
    const entry = parseBuildReviewCacheEntryCandidate(JSON.parse(await fs.readFile(cacheEntryPath(projectRoot, rubric, semanticIdentity))));
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
  if (lookup.semanticIdentity !== undefined) {
    const cachedIdentity = entry.semanticIdentity;
    if (cachedIdentity === undefined) return { kind: "miss", reason: "semantic-identity-missing" };
    if (cachedIdentity.declarationFingerprint !== lookup.semanticIdentity.declarationFingerprint) {
      return { kind: "miss", reason: "declaration-fingerprint-mismatch" };
    }
    if (cachedIdentity.effectiveBundleDigest !== lookup.semanticIdentity.effectiveBundleDigest) {
      return { kind: "miss", reason: "effective-bundle-digest-mismatch" };
    }
    if (cachedIdentity.contractVersion !== lookup.semanticIdentity.contractVersion) {
      return { kind: "miss", reason: "contract-version-mismatch" };
    }
    if (cachedIdentity.projectionVersion !== lookup.semanticIdentity.projectionVersion) {
      return { kind: "miss", reason: "projection-version-mismatch" };
    }
    if (cachedIdentity.semanticInputDigest !== lookup.semanticIdentity.semanticInputDigest) {
      return { kind: "miss", reason: "semantic-input-digest-mismatch" };
    }
    if (cachedIdentity.executionPolicyFingerprint !== lookup.semanticIdentity.executionPolicyFingerprint) {
      return { kind: "miss", reason: "execution-policy-fingerprint-mismatch" };
    }
    if (cachedIdentity.engineStamp !== lookup.semanticIdentity.engineStamp) {
      return { kind: "miss", reason: "engine-content-stamp-mismatch" };
    }
    if (cachedIdentity.provider !== lookup.semanticIdentity.provider) {
      return { kind: "miss", reason: "provider-mismatch" };
    }
    if (cachedIdentity.model !== lookup.semanticIdentity.model) {
      return { kind: "miss", reason: "model-mismatch" };
    }
    if (cachedIdentity.effort !== lookup.semanticIdentity.effort) {
      return { kind: "miss", reason: "effort-mismatch" };
    }
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

/** Atomically replaces one complete candidate entry after validating it. */
export async function writeBuildReviewCacheEntry(
  projectRoot: string,
  entry: BuildReviewCacheEntry,
  fs: BuildReviewCacheFilesystem,
): Promise<void> {
  const validated = parseBuildReviewCacheEntry(entry);
  if (!validated) {
    throw new Error("build-review cache: entry must contain a valid judged result and complete effective candidate identity");
  }
  const path = cacheEntryPath(projectRoot, validated.rubric, validated.semanticIdentity);
  await fs.mkdir(dirname(path));
  await fs.writeFile(`${path}.tmp`, JSON.stringify(validated));
  await fs.rename(`${path}.tmp`, path);
}
