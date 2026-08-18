import type { File, Task, Test } from '@vitest/runner';
import type { Reporter } from 'vitest/reporters';

const RATIONALE =
  'The failing assertions prove the live tier still lacks registry-complete Claude/Codex legs, independent credential gating, and one shared claim-to-finish body.';

export default class AcceptanceRedReporter implements Reporter {
  onFinished(files: File[], errors: unknown[]): void {
    const tests: Test[] = [];
    const visit = (task: Task): void => {
      if (task.type === 'test') {
        tests.push(task);
        return;
      }
      if ('tasks' in task) {
        for (const child of task.tasks) visit(child);
      }
    };
    for (const file of files) visit(file);

    const failed = tests.filter((test) => test.result?.state === 'fail');
    const passed = tests.filter((test) => test.result?.state === 'pass');
    const skipped = tests.filter((test) => test.mode === 'skip' || test.mode === 'todo');
    const failingTests = failed.map((test) => ({
      name: test.name,
      reason: test.result?.errors?.[0]?.message?.split('\n')[0] ?? 'acceptance assertion failed',
    }));

    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests,
      intentRationale: RATIONALE,
    })}\n`);
  }
}
