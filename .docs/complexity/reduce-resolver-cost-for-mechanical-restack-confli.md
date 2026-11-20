# Complexity: Reduce mechanical restack resolver cost

Tier: L

The approved comprehensive scope crosses replay candidate selection, conflict resolution, durable resolution reuse, interrupted-operation recovery, acceptance before atomic application, and event-based reporting. Correctness depends on preserving parent and child behavior across changed histories and retries. This is a complex state-machine change, not a localized two-file hotfix.

Full architecture review, conflict check, coherence check, and plan review are required. No product PRD is required because the approved track is technical. No stacked-delivery decision has been made.

Source: jstoup111/ai-conductor#3632
