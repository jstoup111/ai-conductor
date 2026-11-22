# Recover stale test proof before build review (#3586)

Track: product

Scope boundary: Check test proof before dispatching build_review on normal entry, direct entry, resume, and stacked-child entry. If review input assembly discovers stale proof after that check, use the same bounded recovery in the same build context. Count automatic suite reruns per feature across restarts. Current proof proceeds immediately, and genuine suite failures take the existing test-failure route. On exhaustion, identify both steps and the number of attempts.

This changes when the daemon can recover on its own and when the operator must intervene.
