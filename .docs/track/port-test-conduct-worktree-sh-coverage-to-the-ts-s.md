# Track: Port test_conduct_worktree.sh coverage to the TS suite

Track: technical

Test-infrastructure port with no user-facing behavior: audit which behaviors the 925-line
bash whitebox test pins, port only the genuine coverage gaps as black-box TS/vitest tests
against `src/engine/`, and let the v1.0 cutover PR (#226) delete the bash file. Approach A
(behavioral-parity) chosen over 1:1 exhaustive port (two-thirds of assertions grep `bin/conduct`
source that is being removed) and delete-only (leaves real gaps uncovered). Blocker for #228.
