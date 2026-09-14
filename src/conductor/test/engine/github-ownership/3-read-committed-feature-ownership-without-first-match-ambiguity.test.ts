// Covers: task:3
import { describe, expect, it, vi } from 'vitest';

const MUTATION_PROVENANCE_MODULE = '../../../src/engine/owner-gate/mutation-provenance.js';

type CommittedRecord = {
  path: string;
  content: string;
};

type ProvenanceRequest = {
  repository: string;
  defaultBranch: string;
  specBranch: string;
  featureMarker: string;
  publication: 'initial' | 'merged';
  hints?: {
    haltMarker?: string;
    branchPrefix?: string;
    shipmentRecord?: string;
    pullRequestAuthor?: string;
    gitAuthor?: string;
  };
};

type CommittedOwnershipDiscovery = {
  readCommittedRecords: (input: {
    repository: string;
    ref: string;
  }) => Promise<CommittedRecord[]>;
};

type MutationProvenanceModule = {
  readMutationProvenance: (
    request: ProvenanceRequest,
    discovery: CommittedOwnershipDiscovery,
  ) => Promise<unknown>;
};

async function readMutationProvenance(
  request: ProvenanceRequest,
  discovery: CommittedOwnershipDiscovery,
): Promise<unknown> {
  const module = await import(MUTATION_PROVENANCE_MODULE) as unknown as MutationProvenanceModule;
  return module.readMutationProvenance(request, discovery);
}

function discoveryFor(
  recordsByRef: Record<string, CommittedRecord[]>,
): CommittedOwnershipDiscovery & { readCommittedRecords: ReturnType<typeof vi.fn> } {
  return {
    readCommittedRecords: vi.fn(async ({ ref }: { ref: string }) => recordsByRef[ref] ?? []),
  };
}

const ownedSpec = (owner: string): CommittedRecord => ({
  path: '.docs/specs/owned.md',
  content: `# Owned feature\n\nOwner: ${owner}\n`,
});

describe('engine/owner-gate/mutation-provenance — committed feature ownership', () => {
  it('uses committed default-branch ownership after merge, never a different spec-branch owner', async () => {
    const discovery = discoveryFor({
      main: [ownedSpec('alice')],
      'spec/owned': [ownedSpec('bob')],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'merged',
    }, discovery)).resolves.toEqual({
      kind: 'owned',
      owner: 'alice',
      ref: 'main',
    });
    expect(discovery.readCommittedRecords).toHaveBeenCalledTimes(1);
    expect(discovery.readCommittedRecords).toHaveBeenCalledWith({ repository: 'acme/rocket', ref: 'main' });
  });

  it('uses committed spec-branch ownership for initial publication, before a default-branch record can exist', async () => {
    const discovery = discoveryFor({
      main: [ownedSpec('alice')],
      'spec/owned': [ownedSpec('bob')],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({
      kind: 'owned',
      owner: 'bob',
      ref: 'spec/owned',
    });
    expect(discovery.readCommittedRecords).toHaveBeenCalledTimes(1);
    expect(discovery.readCommittedRecords).toHaveBeenCalledWith({ repository: 'acme/rocket', ref: 'spec/owned' });
  });

  it.each([
    [
      'missing ownership',
      [
        { path: '.docs/specs/owned.md', content: '# Owned feature\n' },
      ],
      { kind: 'refused', reason: 'missing-provenance' },
    ],
    [
      'conflicting records for the requested feature marker',
      [ownedSpec('alice'), { path: '.docs/specs/owned.md', content: 'Owner: bob\n' }],
      { kind: 'refused', reason: 'conflicting-provenance' },
    ],
    [
      'contradictory duplicate Owner lines in one committed record',
      [{ path: '.docs/specs/owned.md', content: 'Owner: alice\nOwner: bob\n' }],
      { kind: 'refused', reason: 'duplicate-conflicting-owner' },
    ],
  ])('parses every committed Owner line and refuses %s instead of accepting a first match', async (_caseName, records, expected) => {
    const discovery = discoveryFor({ 'spec/owned': records });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual(expected);
  });

  it.each([
    ['a blank Owner line before an explicit owner', 'Owner:\nOwner: bob\n'],
    ['an explicit owner before a blank Owner line', 'Owner: bob\nOwner:\n'],
  ])('treats %s as the same strict ambiguity, never a first-match owner', async (_caseName, content) => {
    const discovery = discoveryFor({
      'spec/owned': [{ path: '.docs/specs/owned.md', content }],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({
      kind: 'refused',
      reason: 'duplicate-conflicting-owner',
    });
  });

  it.each([
    ['an unreadable committed record', new Error('git show failed'), 'provenance-unreadable'],
    ['a timed-out committed record read', new Error('read timed out'), 'provenance-timeout'],
    ['a literal timeout failure', new Error('timeout'), 'provenance-timeout'],
    [
      'a structured timeout failure',
      Object.assign(new Error('committed read failed'), { code: 'ETIMEDOUT' }),
      'provenance-timeout',
    ],
  ])('refuses %s without manufacturing ownership', async (_caseName, failure, reason) => {
    const discovery = {
      readCommittedRecords: vi.fn().mockRejectedValue(failure),
    };

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({ kind: 'refused', reason });
  });

  it('never treats a halt marker, branch prefix, shipment, PR author, or git author as ownership', async () => {
    const discovery = discoveryFor({ 'spec/owned': [] });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
      hints: {
        haltMarker: '<!-- owner: alice -->',
        branchPrefix: 'feature/alice-owned',
        shipmentRecord: '.docs/shipped/owned.md',
        pullRequestAuthor: 'alice',
        gitAuthor: 'alice',
      },
    }, discovery)).resolves.toEqual({ kind: 'refused', reason: 'missing-provenance' });
  });

  it('normalizes a committed CRLF Owner value before returning the unambiguous owner', async () => {
    const discovery = discoveryFor({
      'spec/owned': [{ path: '.docs/specs/owned.md', content: 'Owner: Alice-Bot \r\n' }],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({
      kind: 'owned',
      owner: 'alice-bot',
      ref: 'spec/owned',
    });
  });

  it('refuses a target marker with no Owner even when an unrelated committed marker names an owner', async () => {
    const discovery = discoveryFor({
      'spec/owned': [
        { path: '.docs/specs/owned.md', content: '# Owned feature\n' },
        { path: '.docs/specs/unrelated.md', content: 'Owner: alice\n' },
      ],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({ kind: 'refused', reason: 'missing-provenance' });
  });

  it('uses the target marker owner and does not treat an unrelated marker as conflicting provenance', async () => {
    const discovery = discoveryFor({
      'spec/owned': [
        ownedSpec('alice'),
        { path: '.docs/specs/unrelated.md', content: 'Owner: bob\n' },
      ],
    });

    await expect(readMutationProvenance({
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    }, discovery)).resolves.toEqual({
      kind: 'owned',
      owner: 'alice',
      ref: 'spec/owned',
    });
  });
});
