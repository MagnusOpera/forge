SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install dev build run package-mac-arm64 package-windows-x64 package-windows-arm64 package-linux-x64 package-linux-arm64 package-release-archives website website-build verify-changelog release-prepare check typecheck test audit preview clean

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
	@printf "  make package-windows-x64 version=x.y.z  Build unsigned Windows x64 ZIP\n"
	@printf "  make package-windows-arm64 version=x.y.z  Build unsigned Windows arm64 ZIP\n"
	@printf "  make package-linux-x64 version=x.y.z  Build unsigned Linux x64 tarball\n"
	@printf "  make package-linux-arm64 version=x.y.z  Build unsigned Linux arm64 tarball\n"
	@printf "  make website    Preview the GitHub Pages website\n"
	@printf "  make website-build  Build the GitHub Pages website\n"
	@printf "  make release-prepare version=x.y.z  Move changelog, commit, and tag\n"
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
	npm run build
	./.github/scripts/package-electron-artifact.sh mac arm64 "$(version)"

package-windows-x64:
	npm run build
	./.github/scripts/package-electron-artifact.sh windows x64 "$(version)"

package-windows-arm64:
	npm run build
	./.github/scripts/package-electron-artifact.sh windows arm64 "$(version)"

package-linux-x64:
	npm run build
	./.github/scripts/package-electron-artifact.sh linux x64 "$(version)"

package-linux-arm64:
	npm run build
	./.github/scripts/package-electron-artifact.sh linux arm64 "$(version)"

package-release-archives:
	npm run build
	./.github/scripts/package-electron-artifact.sh mac arm64 "$(version)"
	./.github/scripts/package-electron-artifact.sh windows x64 "$(version)"
	./.github/scripts/package-electron-artifact.sh windows arm64 "$(version)"
	./.github/scripts/package-electron-artifact.sh linux x64 "$(version)"
	./.github/scripts/package-electron-artifact.sh linux arm64 "$(version)"

website:
	npm run website

website-build:
	npm run website:build

verify-changelog:
	REQUIRE_CHANGELOG_ALWAYS=true .github/scripts/check-unreleased-changelog.sh

release-prepare:
	./.github/scripts/release.sh "$(version)" "$(dryrun)"

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
