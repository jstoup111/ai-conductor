# Track: Namespace harness skill names (ac- prefix)

Track: technical

Scope boundary: Comprehensive outcome, delivered in two sequenced specs (`adr-2026-10-14-ac-prefixed-skill-names` Decision 7). This spec (Spec 1) makes every host-visible skill name a read of the skill's frontmatter `name:`: engine dispatch on Claude, Codex and Pi, the composer launcher, monitor and prelude launches, operator-only `skillOverrides`, install-freshness, the self-host provider home, and `bin/install` link names all resolve names from frontmatter in the skill tree they serve. Every frontmatter `name:` stays equal to its directory, so no visible name changes. Spec 2, follow-up intake jstoup111/ai-conductor#3233 blocked on this spec, flips every `name:` to `ac-<dir>` and adds bare-link reconcile, collision reporting, integrity enforcement, reference rewrites, the model table and the consumer migration. Excluded from both: `agents/` persona files, Claude plugin packaging, compatibility aliases, and rewriting consumer projects' own prose.

Harness tooling rename plus install/integrity machinery with no product requirements; acceptance
criteria live in stories.
