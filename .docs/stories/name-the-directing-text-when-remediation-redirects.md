**Status:** Accepted

# Stories: Name the directing text when remediation redirects a gap away from build (#1851)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the diagnostic content of a sealed-artifact redirect: the redirect event, its rendered line, and the DECIDE-entry halt body an operator reads. Detection itself already shipped and is unchanged; whether a redirect should target an ungrantable step at all remains outside this slice.

## Story 1: A redirect reports the text it read as directing the edit

As an operator triaging a terminal remediation halt, I want the redirect to quote the exact words it read as directing an edit, so that I can tell a genuine cross-feature amendment from a false positive without reading engine source.

### Acceptance Criteria

#### Happy Path
- Given a remediation gap whose task title directs an edit to another feature's sealed DECIDE artifact, when the sealed-artifact redirect fires, then the emitted redirect event carries the gap id, the resolved artifact, the quoted directing text, and the task title as the input it was read from.
- Given a remediation gap redirected because its rationale prose directs the edit, when the redirect fires, then the emitted redirect event carries the quoted rationale clause and the rationale as the input it was read from.
- Given a redirect event carrying a quoted directing text reaches the daemon event renderer, when the line is rendered, then it shows that quoted text and its source input alongside the gap id and artifact it already showed.

#### Negative Paths
- Given a task title directs an edit to the feature's own artifact before directing one to another feature's sealed artifact, when the redirect fires, then the quoted text is the clause of the redirected foreign artifact rather than the first directing clause in the title.
- Given the directing clause spans multiple lines and exceeds the quote budget, when the redirect event is emitted, then the quoted text is a single whitespace-collapsed line truncated to the budget with a trailing ellipsis and the persisted event ledger record remains one parseable JSON line.
- Given a remediation gap whose task title and rationale only cite a protected artifact as evidence without directing an edit, when remediation routes the gap, then no redirect event is emitted and the gap keeps the disposition its planner authored.
- Given a redirect event that carries no quoted directing text, when the daemon event renderer renders it, then it emits the existing gap-and-artifact line without an empty quote fragment.

### Done When
- [ ] A remediation fixture whose task title directs a foreign sealed amendment observes one redirect event whose quoted text and source input identify the directing clause of the title.
- [ ] A remediation fixture redirected on rationale prose observes a redirect event whose source input is the rationale and whose quote is the rationale clause.
- [ ] A renderer fixture prints the quoted directing text and its source input for a redirect that carries them, and prints the pre-existing line unchanged for one that does not.
- [ ] A citation-only fixture observes no redirect event and a routed build disposition.

## Story 2: The terminal halt carries the redirect's evidence

As an operator whose feature halted with no grantable route, I want the halt body itself to name the artifact and the directing text behind each redirected gap, so that I can decide between correcting the task and accepting the redirect from the halt alone.

### Acceptance Criteria

#### Happy Path
- Given a remediation round redirects one gap and the daemon refuses DECIDE entry, when the halt body is rendered, then its evidence line names that gap with its resolved artifact and its quoted directing text.

#### Negative Paths
- Given the same halted round also routed gaps that were never redirected, when the halt body is rendered, then each of those gaps keeps its bare identifier-and-disposition evidence entry with no artifact and no quote appended.
- Given a redirected gap whose round routes onward instead of halting, when the remediation kickback evidence is recorded, then it carries the same artifact and quoted directing text the halt body would have carried.

### Done When
- [ ] A halted remediation fixture returns a halt body whose evidence line contains the redirected gap id, its artifact, and its quoted directing text.
- [ ] The same fixture's evidence entries for non-redirected gaps are byte-identical to the entries produced before this change.
- [ ] A non-halting fixture records kickback evidence carrying the same artifact and quoted directing text.

## Negative-category review

Invalid and ambiguous input is covered by the multi-path title case, the citation-only case, and the oversized multi-line clause case; together they exercise every way the detector can disagree with a naive reading of the prose. Data integrity is covered by the single-line, truncated quote requirement, which protects the append-only event ledger whose reader rejects any malformed line. The alternate-branch invariant category is covered explicitly: the redirect's diagnostic must survive the routing branch that does not halt, not only the halting one. Partial-failure, rollback, and idempotency categories are inapplicable — the change performs no write beyond one additional field on an event the engine already emits once per redirected gap. Authorization, timeout, dependency-unavailability, concurrency, and resource-exhaustion categories are inapplicable: no external call, no lock, no new storage, and no new process boundary is introduced, and the ungrantable-step policy that makes this halt terminal is deliberately untouched.
