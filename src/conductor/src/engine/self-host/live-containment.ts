/** Result of determining whether a self-host build has filesystem containment. */
export type ContainmentVerdict =
  | { readonly contained: true; readonly evidence: string }
  | { readonly contained: false; readonly reason: string };
