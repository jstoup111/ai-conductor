// quarantine-engineer-signals-cli.ts — production entry point for
// `bin/quarantine-engineer-signals` (T5, jstoup111/ai-conductor#861).
//
// One-shot, operator-invoked maintenance sweep: quarantines
// `"project":"test-project"`-tagged lines out of the real engineer
// signals.jsonl store, backing up the original first. Never invoked
// automatically by tests or the daemon.
//
// Usage: quarantine-engineer-signals-cli.ts [--dry-run]

import { resolveEngineerDir } from './engine/engineer-store.js';
import { quarantineEngineerSignals } from './engine/engineer/quarantine.js';

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const engineerDir = resolveEngineerDir({});

  const result = await quarantineEngineerSignals({ engineerDir, dryRun });

  if (!result.existed) {
    console.log(`quarantine-engineer-signals: no signals.jsonl found under ${engineerDir} — nothing to do.`);
    return;
  }

  if (dryRun) {
    console.log(
      `quarantine-engineer-signals: [dry-run] would keep ${result.kept}, quarantine ${result.quarantined} ` +
        `(total ${result.total}). No files written.`,
    );
    return;
  }

  console.log(
    `quarantine-engineer-signals: kept ${result.kept}, quarantined ${result.quarantined} ` +
      `(total ${result.total}). Backup: ${result.backupPath}`,
  );
}

main().catch((error) => {
  console.error(
    `quarantine-engineer-signals: fatal error — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
