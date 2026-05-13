# Cucumber Runner

Discover, run, and inspect Cucumber/Gherkin tests from VS Code Test Explorer.

Cucumber Runner uses official Cucumber packages for Gherkin parsing and Cucumber's `message` formatter for structured results. It does not fork, replace, or depend on the official Cucumber VS Code extension.

## Features

- Discover `.feature` files in single-root and multi-root workspaces.
- Show workspace folders, feature files, features, scenarios, Scenario Outline example rows, and steps in Test Explorer.
- Run all tests, a feature, a scenario, a Scenario Outline, or one Examples row.
- Debug all tests, a feature, a scenario, a Scenario Outline, or one Examples row through the VS Code Testing debug profile.
- Capture stdout/stderr in `OutputChannel: Cucumber Runner`.
- Parse Cucumber message NDJSON for scenario/example/step status, duration, errors, stack traces, and attachments/logs.
- Open full last-run details, item-level details, copy details, and reveal source.
- Fall back to process exit code when no structured report is available.

## Screenshots

TODO_SCREENSHOT: Add Marketplace screenshots before publishing.

Recommended screenshots:

- Test Explorer tree with Scenario Outline example rows.
- Failed step details panel.
- Output channel with Cucumber message summary.

## Requirements

- VS Code `^1.80.0`.
- A workspace with Cucumber feature files.
- A project command that can run Cucumber, for example `npx cucumber-js`.
- For step-level results, use Cucumber's message formatter via `cucumberRunner.reportFormat: "message"`.

## Settings

```json
"cucumberRunner.configFile": "cucumber.js",
"cucumberRunner.features": ["features/**/*.feature"],
"cucumberRunner.steps": ["src/steps/**/*.ts"],
"cucumberRunner.support": ["src/support/**/*.ts"],
"cucumberRunner.command": "npx cucumber-js",
"cucumberRunner.cwd": "${workspaceFolder}",
"cucumberRunner.reportFormat": "message",
"cucumberRunner.reportOutputPath": "./.cucumber-report.ndjson",
"cucumberRunner.enableAutoDiscovery": true
```

`cucumberRunner.featuresPath` and `cucumberRunner.stepDefinitionsPath` are legacy settings. Prefer `cucumberRunner.features`, `cucumberRunner.steps`, and `cucumberRunner.support`.

For stable repeated runs, prefer putting Cucumber paths and step-definition loading in a project config file and referencing it from the command:

```json
"cucumberRunner.command": "npx cucumber-js --config cucumber.cjs"
```

If `cucumberRunner.cwd` is left as `${workspaceFolder}`, runs use the workspace folder that owns the selected test item. In multi-root workspaces, all-test runs are grouped by workspace folder. If `cucumberRunner.cwd` is set explicitly, it takes priority.

## Commands

- `Cucumber: Refresh Tests`
- `Cucumber: Run All Tests`
- `Cucumber: Run Current Feature`
- `Cucumber: Run Current Scenario`
- `Cucumber: Show Last Run Details`
- `Cucumber: Show Details`
- `Cucumber: Copy Details`
- `Cucumber: Reveal Source`
- `Cucumber: Open Last Report`

The item-level commands are also contributed to the Testing item context menu when supported by the current VS Code version.

## Cucumber Message Reports

When `reportFormat` is `message`, the extension adds:

```bash
--format message:./.cucumber-report.ndjson
```

After the run, it reads the NDJSON report and maps results back to scenarios, Scenario Outline example rows, and steps. If the report is missing, empty, or invalid, the run still completes using exit-code fallback.

## Scenario Outline Support

Scenario Outline rows are displayed as separate test cases:

```text
Scenario Outline: User login
  Example #1: username=admin, password=valid, ...
    Given user "admin"
    When login with "valid"
    Then status is "success"
  Example #2: username=admin, password=invalid, ...
    Given user "admin"
    When login with "invalid"
    Then status is "failure"
```

Running an example row uses the `.feature` file plus the row line from the Examples table:

```bash
npx cucumber-js --config cucumber.cjs features/login.feature:10
```

## Debugging

Use the Testing sidebar debug action on all tests, a feature, a scenario, a Scenario Outline, or a single Examples row.

Recommended project setup:

```js
// cucumber.cjs
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    requireModule: ['ts-node/register'],
    require: ['src/support/**/*.ts', 'src/steps/**/*.ts'],
    format: ['progress'],
    parallel: 1
  }
};
```

Debug launches use VS Code's Node debugger with `node --inspect-brk` and the project-local `node_modules/@cucumber/cucumber/bin/cucumber-js`. The extension dynamically appends the selected feature path or `feature:line` target, for example:

```bash
node --inspect-brk node_modules/@cucumber/cucumber/bin/cucumber-js --config cucumber.cjs features/login.feature:3
```

Set breakpoints in step definition files, then start Debug from Test Explorer. Debug stdout/stderr is shown in the integrated terminal. Structured results and details are still read from the Cucumber message report.

Known debug requirements:

- Install `@cucumber/cucumber` locally in the tested workspace.
- Use a command like `npx cucumber-js --config cucumber.cjs`.
- Keep step-definition loading in `cucumber.cjs`; otherwise Cucumber may report undefined steps.
- If a debug launch fails, check `OutputChannel: Cucumber Runner` for the resolved command and error.

## Details Panel

After a structured run, right-click a test item in Test Explorer:

- `Cucumber: Show Details`
- `Cucumber: Copy Details`
- `Cucumber: Reveal Source`

Details are shown in a script-free Webview and include status, duration, source location, example values, step list, logs, error message, and stack trace. If VS Code does not pass the Testing item to the context-menu command, open the `.feature` file, place the cursor on the relevant line, and run the command from the Command Palette.

## Development

```bash
npm install
npm run compile
npm run test:parser
npm run test:details
npm run test:integration
npm run bundle
npm run package
```

`npm run test:integration` verifies that the integration scaffold and sample workspace are present. Set `RUN_VSCODE_INTEGRATION=1` to launch VS Code through `@vscode/test-electron`; UI interactions in the Testing sidebar should still be verified manually.

Manual release testing is documented in `docs/manual-test.md` and `docs/release-checklist.md` in the source repository.

## Troubleshooting

- No step-level results: set `cucumberRunner.reportFormat` to `message`.
- No tests discovered: check `cucumberRunner.features`.
- Wrong working directory: leave `cucumberRunner.cwd` as `${workspaceFolder}` for workspace-aware defaults, or set it explicitly.
- Context menu does not target an item: use the active `.feature` editor fallback.
- Report parse warning: inspect `cucumberRunner.reportOutputPath` and stdout/stderr in `Cucumber Runner`.
- Undefined steps: make sure `cucumberRunner.steps`/`support`, `cucumber.js` `requireModule`/`require`, and `cwd` match the project.
- Missing require paths: put `paths`, `require`, and `requireModule` in `cucumber.cjs` instead of relying on repeated CLI state.
- Broken config: run `npx cucumber-js --config cucumber.cjs` from the workspace root and fix terminal errors first.
- Invalid command: verify that the extension command can run from `cucumberRunner.cwd`.
- Repeated runs become undefined: avoid commands that omit `--config`; use a stable Cucumber config and project-local `@cucumber/cucumber`.

## Known Limitations

- JSON report parsing is not implemented; message NDJSON is the supported structured format.
- `stepDefinitionsPath` is a legacy setting. Use `cucumberRunner.steps`.
- Testing sidebar UI is not fully covered by automated tests.
- Marketplace screenshots and publisher metadata are placeholders before publication.

## Privacy And Data

The extension runs the configured Cucumber command locally in your workspace and reads local stdout/stderr plus local report files. It does not send feature files, test output, reports, logs, or settings to any external service.

## Publishing Status

This is a preview release candidate.

Before publishing, replace:

- `TODO_PUBLISHER`: Marketplace publisher. The current package uses `todo-publisher` because VSCE requires a lowercase publisher id.
- `TODO_REPOSITORY_URL`: repository URL in `package.json`.
- `TODO_DISPLAY_NAME`: confirm the Marketplace display name.
- `TODO_ICON`: add a Marketplace icon if desired.
- `TODO_SCREENSHOT`: add Marketplace screenshots.
