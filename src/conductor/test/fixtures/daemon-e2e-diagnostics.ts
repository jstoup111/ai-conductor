import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Returns the dump so callers can embed it in a thrown error's message —
// CI smoke reporters keep failureMessages but drop console output.
export async function dumpPipelineDiagnostics(worktreeDir: string): Promise<string> {
  const lines: string[] = [];
  const emit = (line: string): void => { lines.push(line); };
  const logPath = join(worktreeDir, '.daemon/daemon.log');
  const daemonLog = await readFile(logPath, 'utf-8').catch(() => null);

  if (daemonLog === null) {
    emit(`daemon log not found at ${logPath}`);
  } else {
    emit(`daemon log tail from ${logPath}`);
    emit(daemonLog.split('\n').slice(-50).join('\n'));
  }

  const haltPath = join(worktreeDir, '.pipeline/HALT');
  const haltReason = await readFile(haltPath, 'utf-8').catch(() => null);
  if (haltReason === null) {
    emit(`halt marker not found at ${haltPath}`);
  } else {
    emit(`halt marker at ${haltPath}`);
    emit(haltReason);
  }

  for (const [label, path] of [
    ['task status', join(worktreeDir, '.pipeline/task-status.json')],
    ['task evidence', join(worktreeDir, '.pipeline/task-evidence.json')],
  ]) {
    const contents = await readFile(path, 'utf-8').catch(() => null);
    if (contents === null) {
      emit(`${label} not found at ${path}`);
    } else {
      emit(`${label} at ${path}`);
      emit(contents);
    }
  }

  const parkedDir = join(worktreeDir, '.daemon/parked');
  const parkedEntries = await readdir(parkedDir).catch(() => []);
  if (parkedEntries.length === 0) {
    emit(`park markers not found in ${parkedDir}`);
  }
  for (const entry of parkedEntries) {
    const markerPath = join(parkedDir, entry);
    const reason = await readFile(markerPath, 'utf-8').catch(() => null);
    if (reason !== null) {
      emit(`park marker at ${markerPath}`);
      emit(reason);
    }
  }

  const dump = lines.join('\n');
  console.error(dump);
  return dump;
}
