# Track: Judge lane never dispatches on resumed/stalled build-gate residue (#570)

Track: technical

Internal engine bug fix to the #520 semantic-attribution-judge dispatch predicate
(conductor.ts). No user-facing product behavior or requirements — acceptance criteria
live directly in stories. Chosen fix: Approach A (drop the `!isZeroWork` guard so the
judge dispatches on inherited residue when cutover is armed).
