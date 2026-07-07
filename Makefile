SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install dev build run check typecheck audit preview clean

help:
	@printf "GitHub Focus\n\n"
	@printf "Targets:\n"
	@printf "  make install    Install npm dependencies\n"
	@printf "  make dev        Run Vite, Electron main watcher, and Electron app\n"
	@printf "  make build      Build Electron main/preload and renderer assets\n"
	@printf "  make run        Run the built Electron app\n"
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

typecheck:
	npm run typecheck

audit:
	npm audit --audit-level=high

check: typecheck audit

preview: build
	npm run preview

clean:
	rm -rf dist dist-electron
