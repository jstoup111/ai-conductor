/**
 * Daemon-mode conductors cannot own process SIGHUP: the daemon handler must
 * flush the shared OTel spool and re-raise the signal. Each conductor instead
 * registers its state-persistence work here, and the daemon handler awaits
 * every registered hook before it flushes and re-raises.
 */
type SighupPersistenceHook = () => Promise<void>;

const hooks = new Set<SighupPersistenceHook>();

export function registerSighupPersistence(hook: SighupPersistenceHook): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/** Run every registered hook; one hook's failure never skips another. */
export async function runSighupPersistence(): Promise<void> {
  await Promise.allSettled([...hooks].map((hook) => Promise.resolve().then(hook)));
}
