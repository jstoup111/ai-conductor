.PHONY: check

check:
	npm --prefix src/conductor run typecheck
	npm --prefix src/conductor run typecheck:test
