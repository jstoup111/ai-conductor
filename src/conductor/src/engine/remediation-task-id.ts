/** H9 task-id grammar used to recognize engine-appended remediation tasks. */
const REMEDIATION_TASK_ID = /^rem-[A-Za-z0-9._-]+$/;

/** True when an id carries the `rem-` signal accepted by either engine writer. */
export function isEngineAppendedRemediationTaskId(id: string): boolean {
  return REMEDIATION_TASK_ID.test(id);
}
