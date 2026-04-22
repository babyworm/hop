## Background

Windows users reported that touchpad pinch zoom does not work in HOP, while the same editor logic works in the `rhwp` Chrome extension.

## Problem

HOP uses Tauri 2 on Windows, which maps WebView2 pinch zoom availability through window creation settings. HOP currently leaves those settings at their defaults, so the embedded WebView can block trackpad pinch before the editor receives the expected `ctrl + wheel` style gesture events.

## Goal

Enable Windows touchpad pinch zoom in HOP without changing macOS or Linux behavior.

## Non-goals

- Rework upstream editor zoom logic in `third_party/rhwp`
- Change macOS or Linux zoom behavior
- Solve unrelated WebView2 swipe-navigation regressions

## Constraints

- Keep `third_party/rhwp` read-only
- Avoid enabling non-Windows Tauri zoom polyfills that may conflict with current editor zoom handling
- Keep multi-window behavior consistent

## Implementation outline

1. Add a Windows-only Tauri config override for the main window with `zoomHotkeysEnabled: true`.
2. Enable the same setting on programmatically created editor windows in Rust behind `#[cfg(windows)]`.
3. Leave the base Tauri config unchanged so macOS/Linux do not receive the non-Windows zoom polyfill.

## Verification plan

- Validate the merged config and Rust code paths compile cleanly.
- Run focused studio and desktop checks that cover Tauri config loading and Rust compilation.
- Re-review the Windows-only code paths for unintended cross-platform effects.

## Rollback / recovery

Revert the Windows override file and the Windows-only builder setting in `apps/desktop/src-tauri/src/windows.rs`.
