import type { Ledger } from './ledger.js';
import type { IntakeQueue } from './queue.js';

export interface ReconcileStrandedClaimsDependencies {
  queue: IntakeQueue;
  ledger: Ledger;
}

function entryKey(source: string, sourceRef: string): string {
  return `${source}\u0000${sourceRef}`;
}

function claimedFilename(id: string, receivedAt: string): string {
  const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9\-.]/g, '_');
  return `${sanitize(receivedAt)}__${sanitize(id)}.claimed`;
}

export async function reconcileStrandedClaims({
  queue,
  ledger,
}: ReconcileStrandedClaimsDependencies): Promise<{ released: string[] }> {
  const pendingKeys = new Set(
    (await ledger.list())
      .filter((entry) => entry.status === 'pending')
      .map((entry) => entryKey(entry.source, entry.sourceRef)),
  );
  const released: string[] = [];

  for (const envelope of await queue.listClaimed()) {
    if (!pendingKeys.has(entryKey(envelope.source, envelope.sourceRef))) continue;

    try {
      await queue.release(envelope);
      released.push(envelope.sourceRef);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not release stranded intake claim ${envelope.sourceRef} from ${claimedFilename(envelope.id, envelope.receivedAt)}: ${message}`,
        { cause: error },
      );
    }
  }

  return { released };
}
