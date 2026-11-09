# Intake origin: routed-residue-finding-lands-on-a-taskless-host-an

Source-Ref: jstoup111/ai-conductor#3590
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3590 digest=3a455147570ddcaedd7baee3313ae0dd9e20879364bd7c45ae45f03c899c8119 >>>
## Desired outcome

- A residue finding is never assigned to a host that has no dispatchable work for it while another candidate host owns the bound task.
- If a routed host has nothing to do, the round still moves to its remaining hosts. A host with nothing to do doesn't halt the feature by itself.
- The operator has a supported, recorded way to recover a round that is stuck on a host with nothing to do, short of hand-editing routing refs.
- Negative path: when a residue item's only candidate is the host that owns its bound task, it is still routed to that host and repaired there.
<<< END INBOUND >>>
