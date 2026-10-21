// Covers: task:17
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_ROOT = resolve(CONDUCTOR_ROOT, '../..');

type WorkflowMapping = Record<string, unknown>;

function mapping(value: unknown, label: string): WorkflowMapping {
  expect(value, `${label} must be a mapping`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as WorkflowMapping;
}

function pullRequestTrigger(workflow: WorkflowMapping, label: string): WorkflowMapping {
  const events = mapping(workflow.on, `${label} events`);
  return mapping(events.pull_request, `${label} pull_request trigger`);
}

describe('structural: stacked pull-request CI triggers', () => {
  it('runs CI and the child-ready release checks for stack-member pull requests', async () => {
    const [ciSource, releaseMetadataSource, shippedRecordSource] = await Promise.all([
      readFile(resolve(REPOSITORY_ROOT, '.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve(REPOSITORY_ROOT, '.github/workflows/release-metadata.yml'), 'utf8'),
      readFile(resolve(REPOSITORY_ROOT, '.github/workflows/shipped-record.yml'), 'utf8'),
    ]);
    const ci = mapping(loadYaml(ciSource), 'CI workflow');
    const releaseMetadata = mapping(loadYaml(releaseMetadataSource), 'release metadata workflow');
    const shippedRecord = mapping(loadYaml(shippedRecordSource), 'shipped-record workflow');

    expect({
      ciBranches: pullRequestTrigger(ci, 'CI workflow').branches,
      ciGate: mapping(ci.jobs, 'CI workflow jobs')['ci-gate'],
      releaseMetadataBranches: pullRequestTrigger(releaseMetadata, 'release metadata workflow').branches,
      releaseMetadataTypes: pullRequestTrigger(releaseMetadata, 'release metadata workflow').types,
      releaseMetadataCondition: mapping(
        mapping(releaseMetadata.jobs, 'release metadata workflow jobs')['release-metadata'],
        'release-metadata job',
      ).if,
      shippedRecordBranches: pullRequestTrigger(shippedRecord, 'shipped-record workflow').branches,
    }).toEqual({
      ciBranches: ['main', 'feat/c*/**'],
      ciGate: expect.any(Object),
      releaseMetadataBranches: undefined,
      releaseMetadataTypes: ['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review'],
      releaseMetadataCondition: "github.event.pull_request.head.ref != 'automation/release-pr' && !github.event.pull_request.draft",
      shippedRecordBranches: undefined,
    });
  });
});
