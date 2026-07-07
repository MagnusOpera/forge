SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install dev build run package-mac-arm64 verify-changelog check typecheck test audit preview clean

version ?= 0.1.0
app_version ?= $(patsubst v%,%,$(version))

help:
	@printf "Forge\n\n"
	@printf "Targets:\n"
	@printf "  make install    Install npm dependencies\n"
	@printf "  make dev        Run Vite, Electron main watcher, and Electron app\n"
	@printf "  make build      Build Electron main/preload and renderer assets\n"
	@printf "  make run        Run the built Electron app\n"
	@printf "  make package-mac-arm64 version=x.y.z  Build unsigned macOS arm64 ZIP\n"
	@printf "  make test       Run unit tests\n"
	@printf "  make check      Run typecheck and high-severity audit\n"
	@printf "  make preview    Preview the built renderer in a browser\n"
	@printf "  make clean      Remove generated build outputs\n"

install:
	npm install

dev:
	npm run dev

build:
	npm run build

run: build
	npx electron .

package-mac-arm64:
	rm -rf .out/electron
	npm run build
	npx electron-builder --mac zip --arm64 --config.extraMetadata.version=$(app_version)
	mkdir -p .out
	@artifact=$$(find .out/electron -maxdepth 1 -type f -name '*.zip' -print -quit); \
	if [[ -z "$$artifact" ]]; then \
		echo "No macOS arm64 ZIP was produced."; \
		exit 1; \
	fi; \
	cp "$$artifact" ".out/forge-$(version)-mac-arm64-unsigned.zip"; \
	echo "Created .out/forge-$(version)-mac-arm64-unsigned.zip"

verify-changelog:
	REQUIRE_CHANGELOG_ALWAYS=true .github/scripts/check-unreleased-changelog.sh

typecheck:
	npm run typecheck

test:
	npm test

audit:
	npm audit --audit-level=high

check: typecheck test audit

preview: build
	npm run preview

clean:
	rm -rf dist dist-electron
	rm -rf .out
