// Covers: task:2
import { expect, it } from 'vitest';
import { PUBLICATION_TRANSITION_DIMENSIONS } from '../../src/engine/finish-publication.js';

it('maps each stacked publication transition to the stack dimension', () => {
  expect(PUBLICATION_TRANSITION_DIMENSIONS).toMatchObject({
    establish_child_prs: 'stack',
    assemble_stack: 'stack',
  });
});
