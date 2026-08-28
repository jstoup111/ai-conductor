CONDUCTOR_DIR := src/conductor
CONDUCTOR_DEPS_STAMP := $(CONDUCTOR_DIR)/node_modules/.ai-conductor-deps-ready
CONDUCTOR_PACKAGE_FILES := $(CONDUCTOR_DIR)/package.json $(CONDUCTOR_DIR)/package-lock.json

.PHONY: check

$(CONDUCTOR_DEPS_STAMP): $(CONDUCTOR_PACKAGE_FILES)
	npm --prefix $(CONDUCTOR_DIR) ci
	touch $(CONDUCTOR_DEPS_STAMP)

check: $(CONDUCTOR_DEPS_STAMP)
	npm --prefix $(CONDUCTOR_DIR) run typecheck
	npm --prefix $(CONDUCTOR_DIR) run typecheck:test
