// Covers: task:4

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type IntakeField = {
  type: string;
  id?: string;
  attributes?: {
    label?: string;
    description?: string;
    options?: string[];
  };
  validations?: { required?: boolean };
};

const CONDUCTOR_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INTAKE_FORM = join(CONDUCTOR_ROOT, '..', '..', '.github', 'ISSUE_TEMPLATE', 'intake.yml');

async function intakeFields(): Promise<IntakeField[]> {
  const form = loadYaml(await readFile(INTAKE_FORM, 'utf8')) as { body: IntakeField[] };
  return form.body;
}

describe('intake issue form semver field', () => {
  it('offers an optional Semver dropdown immediately after required Size while preserving priority and size', async () => {
    const fields = await intakeFields();
    const priority = fields.find((field) => field.id === 'priority');
    const sizeIndex = fields.findIndex((field) => field.id === 'size');
    const size = fields[sizeIndex];
    const semver = fields.find((field) => field.id === 'semver');

    expect(priority?.validations?.required).toBe(true);
    expect(size?.validations?.required).toBe(true);
    expect(fields[sizeIndex + 1]).toBe(semver);
    expect(semver).toEqual({
      type: 'dropdown',
      id: 'semver',
      attributes: {
        label: 'Semver',
        description: 'Optional: is the desired change breaking (major), additive (minor), or a fix (patch)?',
        options: ['major', 'minor', 'patch'],
      },
      validations: { required: false },
    });
  });
});
