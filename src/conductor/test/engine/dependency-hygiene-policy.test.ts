import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { discoverClaudeReviewPolicies } from '../../src/engine/build-review-policy-claude.js';
import { resolveInstalledReviewPolicy } from '../../src/engine/build-review-policy-resolver.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const skillName = 'build-review-dependency-hygiene';
const skillPath = join(repoRoot, 'skills', skillName, 'SKILL.md');

function concern(policy: string, id: string): string {
  const match = policy.match(new RegExp('- `' + id + '`([\\s\\S]*?)(?=\\n- `|\\n## |$)', 'i'));
  expect(match, `missing ${id} concern`).not.toBeNull();
  return match![1];
}

describe('global dependency-hygiene build-review policy', () => {
  // Covers: S4.1, S4.2, S4.3, S4.4
  it('publishes the dependency concerns, evidence, and ecosystem inputs', async () => {
    const policy = await readFile(skillPath, 'utf8');

    expect(policy).toMatch(/^---\r?\nname: build-review-dependency-hygiene\r?\n/m);
    const necessity = concern(policy, 'necessity');
    expect(necessity).toMatch(/at least `major` severity/i);
    expect(necessity).toMatch(/existing\s+declared\s+dependency\s+or\s+an\s+existing\s+in-repo\s+module/i);
    expect(necessity).toMatch(/names?\s+the\s+added\s+dependency\s+and\s+the\s+existing\s+equivalent(?:'s)?\s+path/i);

    const pinning = concern(policy, 'pinning');
    expect(pinning).toMatch(/at least `major` severity/i);
    expect(pinning).toMatch(/`\*`, `latest`, or an unbounded `>=` range/i);
    expect(pinning).toMatch(/manifest\s+change\s+and\s+no\s+matching\s+committed\s+lockfile\s+update/i);
    expect(pinning).toMatch(/name\s+the\s+dependency\s+and\s+the\s+manifest\s+location/i);

    const license = concern(policy, 'license');
    expect(license).toMatch(/on-disk\s+dependency\s+license\s+metadata/i);
    expect(license).toMatch(/project's\s+declared\s+license/i);
    expect(license).toMatch(/incompatible[\s\S]*at least `major` severity/i);
    expect(license).toMatch(/names?\s+both\s+licenses\s+and\s+the\s+evidence\s+location/i);
    expect(license).toMatch(/severity `nit`/i);
    expect(license).toMatch(/license\s+is\s+unverifiable/i);

    expect(policy).toMatch(/npm[\s\S]*package\.json[\s\S]*package-lock\.json/i);
    expect(policy).toMatch(/Yarn[\s\S]*package\.json[\s\S]*yarn\.lock/i);
    expect(policy).toMatch(/pnpm[\s\S]*package\.json[\s\S]*pnpm-lock\.yaml/i);
    expect(policy).toMatch(/Bundler[\s\S]*Gemfile[\s\S]*Gemfile\.lock/i);
    expect(policy).toMatch(/pip[\s\S]*requirements\*\.txt[\s\S]*requirements\*\.lock/i);
    expect(policy).toMatch(/Poetry[\s\S]*pyproject\.toml[\s\S]*poetry\.lock/i);
    expect(policy).toMatch(/uv[\s\S]*pyproject\.toml[\s\S]*uv\.lock/i);
    expect(policy).toMatch(/Go\s+modules[\s\S]*go\.mod[\s\S]*go\.sum/i);
    expect(policy).toMatch(/Cargo[\s\S]*Cargo\.toml[\s\S]*Cargo\.lock/i);
    expect(policy).toMatch(/Maven[\s\S]*\*\*\/pom\.xml[\s\S]*\*\*\/\.mvn\/dependency-locks\//i);
    expect(policy).toMatch(/Gradle[\s\S]*\*\*\/build\.gradle\*[\s\S]*\*\*\/gradle\.lockfile/i);
  });

  // Covers: S4.5, S4.6, S4.7, S4.8
  it('bounds non-findings and excludes claims outside its vocabulary', async () => {
    const policy = await readFile(skillPath, 'utf8');
    const nonFindings = policy.match(/## Non-findings([\s\S]*?)(?=\n## |$)/i);

    expect(nonFindings, 'missing non-findings section').not.toBeNull();
    const section = nonFindings![1];
    expect(section).toMatch(/no\s+finding[\s\S]*no\s+existing\s+equivalent[\s\S]*bounded\s+specifier[\s\S]*matching\s+committed\s+lockfile\s+update[\s\S]*compatible\s+license/i);
    expect(section).toMatch(/no\s+finding[\s\S]*lockfile[\s\S]*integrity\s+or\s+resolution\s+metadata[\s\S]*no\s+added,?\s+removed,?\s+or\s+version-changed\s+dependency/i);
    expect(section).toMatch(/no\s+`?pinning`?\s+finding[\s\S]*caret\s+range[\s\S]*(peer|runtime)\s+dependency[\s\S]*library\s+convention[\s\S]*no\s+lockfile\s+change/i);
    expect(section).toMatch(/vulnerability,?\s+CVE,?\s+and\s+maintenance-activity\s+claims[\s\S]*outside\s+(its|this)\s+vocabulary[\s\S]*never\s+reported/i);
  });

  // Covers: S4.9
  it('resolves exactly one global installation from a Claude user skill root', async () => {
    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: repoRoot,
        env: {},
        skill: skillName,
        projectSkillRoots: [],
        userSkillRoots: [join(repoRoot, 'skills')],
      },
      command: vi.fn(async () => ({ stdout: '[]' })),
    });
    const matching = policies.filter((candidate) => candidate.semanticName === skillName);

    expect(matching).toHaveLength(1);
    expect(resolveInstalledReviewPolicy({ skill: skillName, source: 'global' }, policies)).toMatchObject({
      kind: 'resolved',
      policy: {
        semanticName: skillName,
        source: 'global',
        canonicalSkillPath: expect.stringMatching(/skills\/build-review-dependency-hygiene\/SKILL\.md$/),
      },
    });
  });
});
