# Desktop Release v0.1.5 1-Pager

## Background

The current release train now includes the upstream `rhwp` alignment to `v0.7.3` and a new desktop updater notice flow that removes automatic restart behavior at app startup.

## Problem

Shipping these changes without a coordinated patch release would leave the tagged app version, updater manifest expectations, and release workflow inputs out of sync. The updater UX change also needs to be the version that users receive when they move from the current stable build. The HOP overlay also now overrides additional upstream modules, so the release build must verify that the Vite and Vitest alias maps stay in sync.

## Goal

Release `v0.1.5` with the `rhwp v0.7.3` alignment and the user-approved desktop update notice flow, keeping the app version, release tag, and GitHub release workflow aligned.

## Non-goals

Do not change release asset names, rewrite existing release history, or redesign the release workflow beyond what is needed for `v0.1.5`.

## Constraints

Use `pnpm`, keep the desktop app version aligned with the `v0.1.5` tag, preserve macOS, Windows, and Linux release paths, and avoid logging signing credentials or document contents.

## Implementation outline

Bump the root package, desktop package, Rust crate, Cargo lock entry, and Tauri config to `0.1.5`. Keep the studio-host alias overrides centralized so desktop-only replacements stay aligned across test and production builds. Commit the release-ready state, tag the release commit as `v0.1.5`, push the branch and tag, and dispatch the desktop release workflow with draft release creation enabled so signed installers and updater assets are built from that exact tag.

## Verification plan

Run focused desktop tests, studio-host production build verification, and Rust clippy locally, then trigger the GitHub desktop release workflow for `v0.1.5` with draft release creation enabled and wait for the release artifacts to publish.

## Rollback or recovery notes

If the workflow fails before publishing, fix forward on `main` and rerun from the exact release commit. Repointing `v0.1.5` is allowed only because the release is still unpublished and the user explicitly approved moving the tag.
