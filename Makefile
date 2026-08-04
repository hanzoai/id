# @hanzo/id — the white-label login + identity portal, a pnpm workspace over
# apps/* and pkgs/*. There is no `packageManager` field; the committed
# pnpm-lock.yaml + pnpm-workspace.yaml are what make pnpm the one package
# manager here. Every target calls id's own recursive scripts.

PNPM ?= pnpm

.PHONY: help build test lint tc dev clean distclean

help: ## Show this help.
	@awk 'BEGIN{FS=":.*##";printf "\nUsage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: node_modules ## Build every workspace package (pnpm -r build).
	$(PNPM) build

test: node_modules ## Run the unit suite (vitest run).
	$(PNPM) test

# `tc` is this repo's own name for tsc --noEmit across the workspace. An alias,
# so the fleet-wide verb and the local name reach the same single recipe.
lint: tc ## Static check — alias for tc.

tc: node_modules ## tsc --noEmit across the workspace (pnpm -r tc).
	$(PNPM) tc

dev: node_modules ## Dev server for apps/web.
	$(PNPM) dev

node_modules: ## Install deps (pnpm install --frozen-lockfile).
	$(PNPM) install --frozen-lockfile

# Deliberately NOT `$(PNPM) clean`. That script (scripts/clean.sh) also deletes
# every node_modules in the tree — that is a reinstall, not a clean, and it
# would make `make clean` cost a network round trip before anything could build
# again. Generated output only here; the existing nuke keeps its behaviour and
# its name under distclean below, which is where a nuke belongs.
#
# Explicit workspace globs rather than a recursive find, so this can never
# descend into a package's node_modules and delete a dependency's own output.
clean: ## Remove build output (workspace dist, .turbo, tsbuildinfo). Keeps node_modules.
	rm -rf .turbo apps/*/dist apps/*/.turbo pkgs/*/dist pkgs/*/.turbo
	rm -f tsconfig.tsbuildinfo apps/*/tsconfig.tsbuildinfo pkgs/*/tsconfig.tsbuildinfo

distclean: ## clean + every node_modules — the repo's own scripts/clean.sh. Forces a reinstall.
	$(PNPM) clean
