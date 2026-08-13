import { createLedger } from '../../src/engine/engineer/intake/ledger.js';

interface WorkerInput {
  ledgerPath: string;
  sourceRef: string;
}

const [inputJson] = process.argv.slice(2);
if (!inputJson) throw new Error('intake ledger worker requires its JSON input');

const input = JSON.parse(inputJson) as WorkerInput;

process.send?.({ kind: 'ready' });

process.once('message', (message: unknown) => {
  if (message !== 'go') return;
  void createLedger(input.ledgerPath)
    .record({ source: 'github-issues', sourceRef: input.sourceRef })
    .then(() => {
      process.send?.({ kind: 'done' });
      process.disconnect?.();
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      process.send?.({ kind: 'failed', reason });
      process.disconnect?.();
      process.exitCode = 1;
    });
});
