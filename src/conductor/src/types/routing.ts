export type RoundId = string & { readonly __brand: 'RoundId' };
export type HostState = 'pending' | 'admitted' | 'repairing' | 'reroute-moved' | 'built' | 'restacked' | 'done' | 'rerouted' | 'abandoning' | 'abandoned';
export type RouteKind = 'audit' | 'revalidate' | 'operator';
