// Covers: task:3
import { describe, expect, it } from 'vitest';
import { parseStackedDeliverySignoff } from '../../src/engine/artifacts.js';

describe('parseStackedDeliverySignoff', () => {
  it.each([
    'Stacked-Delivery: approved',
    'stacked-delivery: APPROVED',
  ])('returns approved for an approved sign-off: %s', (content) => {
    expect(parseStackedDeliverySignoff(content)).toBe('approved');
  });

  it.each([
    'Tier: L',
    'Stacked-Delivery: pending',
    null,
  ])('returns absent without an approved sign-off: %s', (content) => {
    expect(parseStackedDeliverySignoff(content)).toBe('absent');
  });

  it('finds a bold sign-off after the tier line and accepts trailing punctuation', () => {
    expect(
      parseStackedDeliverySignoff(`
Tier: L
**Stacked-Delivery:** approved.
`),
    ).toBe('approved');
  });
});
