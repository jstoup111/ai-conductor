import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ACCEPTED_WIDENINGS_PATH = '.pipeline/accepted-widenings.json';
const OVER_SCOPE_ACCEPTANCE_CANDIDATE = 'OVER_SCOPE_ACCEPT:';

export interface AcceptedWidening {
  criterion: string;
  summary: string;
  acceptedAt: string;
}

interface AcceptedWideningsFile {
  version: 1;
  entries: AcceptedWidening[];
}

function isAcceptedWidening(value: unknown): value is AcceptedWidening {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.criterion === 'string' && entry.criterion.trim().length > 0 &&
    typeof entry.summary === 'string' && entry.summary.trim().length > 0 &&
    typeof entry.acceptedAt === 'string' && entry.acceptedAt.trim().length > 0;
}

/** Read a tolerant, feature-local record of operator-approved visible scope additions. */
export async function readAcceptedWidenings(
  projectRoot: string,
): Promise<{ entries: AcceptedWidening[] }> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), 'utf8'),
    );
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as { version?: unknown }).version === 1 &&
      Array.isArray((parsed as { entries?: unknown }).entries) &&
      (parsed as { entries: unknown[] }).entries.every(isAcceptedWidening)
    ) {
      return { entries: (parsed as AcceptedWideningsFile).entries };
    }
  } catch {
    // A missing or malformed prior acceptance never becomes an implicit one.
  }
  return { entries: [] };
}

async function writeAcceptedWidenings(projectRoot: string, entries: AcceptedWidening[]): Promise<void> {
  const path = join(projectRoot, ACCEPTED_WIDENINGS_PATH);
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Add an operator acceptance once; re-clearing an unchanged halt is idempotent. */
export async function recordAcceptedWidening(
  projectRoot: string,
  candidate: Pick<AcceptedWidening, 'criterion' | 'summary'>,
): Promise<AcceptedWidening> {
  const normalized = { criterion: candidate.criterion.trim(), summary: candidate.summary.trim() };
  if (!normalized.criterion || !normalized.summary) {
    throw new Error('accepted widening requires a criterion and summary');
  }
  const current = await readAcceptedWidenings(projectRoot);
  const existing = current.entries.find(
    (entry) => entry.criterion === normalized.criterion && entry.summary === normalized.summary,
  );
  if (existing) return existing;

  const entry: AcceptedWidening = { ...normalized, acceptedAt: new Date().toISOString() };
  await writeAcceptedWidenings(projectRoot, [...current.entries, entry]);
  return entry;
}

/** Machine-readable candidate preserved inside an operator-owned OVER_SCOPE HALT body. */
export function renderOverScopeAcceptanceCandidate(
  candidate: Pick<AcceptedWidening, 'criterion' | 'summary'>,
): string {
  return `${OVER_SCOPE_ACCEPTANCE_CANDIDATE} ${JSON.stringify(candidate)}`;
}

/**
 * The daemon's clear-marker mutation port preserves the old HALT body at
 * `.pipeline/HALT.cleared`. Convert only an explicit OVER_SCOPE candidate in
 * that body into durable operator acceptance; unrelated cleared halts are a
 * no-op.
 */
export async function acceptClearedOverScopeHalt(projectRoot: string): Promise<AcceptedWidening | null> {
  let body: string;
  try {
    body = await readFile(join(projectRoot, '.pipeline', 'HALT.cleared'), 'utf8');
  } catch {
    return null;
  }
  const match = body.match(new RegExp(`^${OVER_SCOPE_ACCEPTANCE_CANDIDATE}\\s+(\\{.+\\})\\s*$`, 'm'));
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]!);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.criterion !== 'string' || typeof candidate.summary !== 'string') return null;
    return recordAcceptedWidening(projectRoot, {
      criterion: candidate.criterion,
      summary: candidate.summary,
    });
  } catch {
    return null;
  }
}
