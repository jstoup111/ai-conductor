function collectTests(tasks, tests = []) {
  for (const task of tasks) {
    if (task.type === 'test') tests.push(task);
    if (Array.isArray(task.tasks)) collectTests(task.tasks, tests);
  }
  return tests;
}

export default class RedEvidenceReporter {
  onFinished(files = [], collectionErrors = []) {
    const tests = collectTests(files);
    const passed = tests.filter((test) => test.result?.state === 'pass');
    const failed = tests.filter((test) => test.result?.state === 'fail');
    const skipped = tests.filter((test) => ['skip', 'todo'].includes(test.result?.state));
    const evidence = {
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: collectionErrors.length,
      failingTests: failed.map((test) => ({
        name: test.name,
        reason: String(test.result?.errors?.[0]?.message ?? 'acceptance assertion failed').split('\n')[0],
      })),
      intentRationale:
        'The failures show that corrupt ledger reads still permit claim/intake progress or that concurrent processes still lose ledger writes.',
    };
    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
  }
}
