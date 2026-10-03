import { describe, expect, it } from 'vitest';
import { classifyGhObservation } from '../../src/execution/gh-observation-classifier.js';

describe('classifyGhObservation', () => {
  it.each([
    ['pr view', ['pr', 'view', '42']],
    ['issue list', ['issue', 'list']],
    ['repo view', ['repo', 'view', 'acme/widgets']],
    ['release download', ['release', 'download', 'v1.0.0']],
    ['explicit REST GET', ['api', '--method', 'GET', 'repos/acme/widgets']],
    ['explicit REST HEAD', ['api', '-X', 'HEAD', 'repos/acme/widgets']],
    ['implicit REST GET without fields', ['api', 'repos/acme/widgets']],
    ['help', ['help', 'pr']],
  ])('keeps recognized reads quiet: %s', (_name, argv) => {
    expect(classifyGhObservation(argv)).toEqual({ kind: 'quiet' });
  });

  it.each([
    ['pr create', ['pr', 'create', '--title', 'title']],
    ['issue comment', ['issue', 'comment', '42', '--body', 'body']],
    ['release upload', ['release', 'upload', 'v1.0.0', 'artifact.tgz']],
    ['REST POST', ['api', '--method', 'POST', 'repos/acme/widgets/issues']],
    ['REST PATCH', ['api', '-X', 'PATCH', 'repos/acme/widgets']],
    ['REST DELETE', ['api', '--method=DELETE', 'repos/acme/widgets']],
    ['REST field-implied write', ['api', 'repos/acme/widgets/issues', '-f', 'title=private title']],
    ['REST raw field-implied write', ['api', 'repos/acme/widgets/issues', '--raw-field', 'title=private title']],
  ])('classifies standard mutations without exposing their arguments: %s', (_name, argv) => {
    expect(classifyGhObservation(argv)).toEqual({ kind: 'mutation' });
  });

  it.each([
    ['GraphQL', ['api', 'graphql', '-f', 'query=mutation { secret }']],
    ['alias', ['alias', 'set', 'publish', 'pr create']],
    ['extension', ['extension', 'exec', 'custom-tool']],
    ['unknown command', ['custom', '--token', 'not-for-output']],
    ['opaque REST input', ['api', 'repos/acme/widgets', '--input', 'payload.json']],
    ['unknown REST method', ['api', '--method', 'PROPFIND', 'repos/acme/widgets']],
  ])('reports opaque forms as possible bypasses without echoing payloads: %s', (_name, argv) => {
    const result = classifyGhObservation(argv);

    expect(result).toEqual({ kind: 'possible-bypass' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('not-for-output');
    expect(JSON.stringify(result)).not.toContain('payload.json');
  });

  it('does not consume stdin or open payload files to classify input', () => {
    const stdin = Buffer.from('sensitive payload remains for gh');
    const before = Buffer.from(stdin);

    expect(classifyGhObservation(['api', 'repos/acme/widgets', '--input', 'body.json']))
      .toEqual({ kind: 'possible-bypass' });
    expect(stdin).toEqual(before);
  });
});
