# Track: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

Track: technical

Scope boundary: This spec supersedes the 2026-08-26 player/composer implementation scope
(operator reversal, 2026-08-28). The `daemon`→`player` rename is dropped entirely: `daemon`
remains the canonical vocabulary, `.daemon/` remains the only state root, and no config keys
are renamed — the mode-aware Player-state resolver and legacy-key normalization leave scope.
What ships: (1) `engineer`→`composer` at the public boundary — canonical CLI verb `compose`
with `engineer` retained as a deprecation-warning alias, `skills/composer` canonical with
`skills/engineer` as a compatibility delegate for both supported host discovery mechanisms;
(2) `ai-conductor` becomes the canonical CLI binary name installed by `bin/install`, with
`conduct-ts` retained as a deprecated alias that warns once per invocation (argv0-based);
(3) the ADR adr-2026-08-26-music-vocabulary-player-composer-rename is amended in place —
including reversing its Decision 4 clause that entrypoints are unchanged. Internal symbols,
filenames (`engineer-cli.ts`, `daemon-*.ts`), and the `bin/conduct` bash CLI are out of scope;
`bin/conduct` removal and the installer cutover remain #226. Verdict vocabulary stays deferred
to #1918. Ordinary documentation upkeep is not a story or BUILD-plan task.

Rationale: technical track — changes developer/operator CLI/skill boundaries and installer
naming, no new end-user product requirement; acceptance criteria live in stories.
