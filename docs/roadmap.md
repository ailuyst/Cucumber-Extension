# Roadmap

This roadmap keeps the 0.0.1 preview focused while making the next steps explicit.

## 0.0.x Stabilization

- Validate discovery on real multi-root workspaces.
- Improve edge-case mapping for Scenario Outline results from Cucumber messages.
- Collect feedback on Testing sidebar context menu support across VS Code versions.
- Improve diagnostics for missing Cucumber command, invalid cwd, and malformed reports.
- Add more fixture coverage for attachments, undefined steps, pending steps, and skipped hooks.
- Keep README and troubleshooting guidance aligned with first-user feedback.

## 0.1.0 Goals

- More robust result mapping using additional Cucumber message metadata where available.
- Rerun failed tests command.
- Better details navigation from failed steps to source.
- Optional richer report viewer.
- More complete integration test coverage for extension activation and discovery.
- Marketplace-ready screenshots and icon.

## Future Ideas

- JSON report parser for legacy Cucumber setups.
- Step definitions navigation.
- Tighter Cucumber Language Server integration without replacing the official extension.
- Parallel run management.
- Test history and trends.
- Flaky test detection.
- Workspace-specific command profiles.
- Better support for non-JavaScript Cucumber CLIs.

## Intentionally Postponed Items

- Running or managing a language server.
- Owning `.feature` formatting, syntax highlighting, or autocomplete.
- Replacing the official Cucumber extension.
- Persisted historical test database.
- Complex compliance automation for dependency licensing.
- Full UI automation of the Testing sidebar.
