# Release Risk Report

This report freezes the release state for the `0.0.1` preview.

## Low Risk Issues

- `publisher` and repository metadata are placeholders until Marketplace publishing.
- `TODO_SCREENSHOT` remains in README as a deliberate Marketplace screenshot placeholder.
- `deps:check` can emit a Node deprecation warning from a transitive `license-checker` dependency, but the command exits successfully.
- The bundled `dist/extension.js` is about 481 KB. It is acceptable for preview and the VSIX is small.

## Medium Risk Issues

- Full VS Code Extension Host automation is environment-sensitive on Windows. The default integration script verifies the scaffold; use `RUN_VSCODE_INTEGRATION=1` on the release machine for a real Extension Host run.
- Testing item context menu behavior depends on VS Code's `testing/item/context` contribution point. The active editor/cursor fallback is implemented.
- Multi-root runs are grouped by workspace folder when `cucumberRunner.cwd` is `${workspaceFolder}`. Projects with shared cross-workspace Cucumber configuration may need an explicit `cucumberRunner.cwd`.
- Scenario/step result mapping relies on URI + line + Cucumber message metadata. This is robust for normal Cucumber.js reports but should be checked against large real-world suites.

## Intentionally Postponed

- Deprecated JSON report parsing.
- Step definition discovery depends on `cucumberRunner.steps` and `cucumberRunner.support`.
- Full UI e2e coverage for the Testing sidebar.
- Marketplace screenshots and icon.
- Rich language-server features such as autocomplete, formatting, and step-definition navigation.

## Known Limitations

- Structured results require `cucumberRunner.reportFormat: "message"`.
- Without a parseable message report, results fall back to process exit code and are less granular.
- Details are stored in memory for the latest run only.
- The extension runs the user's configured command and does not validate the project's Cucumber configuration ahead of time.
- Source maps are generated for local development but excluded from VSIX packaging.

## Manual Verification Required

- Run the extension with F5.
- Open `sample-workspace` in the Extension Development Host.
- Verify discovery in the Testing sidebar.
- Run all tests, one feature, one scenario, one Scenario Outline, and one example row.
- Verify failed step status, error, stack trace, attachment log, details panel, copy details, and reveal source.
- Install the generated VSIX locally and repeat a smoke test.

## Recommended Future Improvements After 0.0.1

- Add real Extension Host UI tests once the release machine is stable.
- Add JSON report parser only if users need legacy report support.
- Remove legacy `stepDefinitionsPath` in a future breaking cleanup.
- Add Marketplace icon and screenshots.
- Add telemetry-free diagnostic command that prints current configuration and discovered feature count.
- Consider finer-grained result mapping tests with real Cucumber.js generated message reports.
