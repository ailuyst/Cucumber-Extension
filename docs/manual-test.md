# Manual Test Guide

## Run The Extension

1. Open this extension project in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` and choose the extension launch configuration.
5. In the Extension Development Host, open `sample-workspace`.

## Sample Workspace Setup

Inside `sample-workspace`, run:

```bash
npm install
```

Recommended extension settings for step-level results:

```json
"cucumberRunner.features": ["features/**/*.feature"],
"cucumberRunner.command": "npx cucumber-js",
"cucumberRunner.reportFormat": "message",
"cucumberRunner.reportOutputPath": "./.cucumber-report.ndjson"
```

## What To Verify

- Testing sidebar shows the workspace folder, `features/login.feature`, feature, scenarios, Scenario Outline example rows, and steps.
- `Cucumber: Run All Tests` runs the sample suite.
- Running `Successful login` passes.
- Running `Failed login` fails and shows assertion details.
- Running one `Example #...` row uses the Examples table line and updates only that example result.
- Output channel `Cucumber Runner` shows stdout/stderr and structured result summary.
- Right-click a scenario/example/step and use:
  - `Cucumber: Show Details`
  - `Cucumber: Copy Details`
  - `Cucumber: Reveal Source`
- Failed step details include the error, stack trace, and attachment log.

## Notes

The Testing item context menu depends on VS Code's `testing/item/context` contribution point. If a VS Code build does not pass the item to the command, open the `.feature` file, place the cursor on the scenario/example/step line, and run the command from the Command Palette.

`npm run test:integration` verifies the scaffold by default. Set `RUN_VSCODE_INTEGRATION=1` when you want it to launch VS Code through `@vscode/test-electron`.
