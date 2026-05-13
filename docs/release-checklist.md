# Release Checklist

Use this checklist before every release.

## Automated Checks

| Check | Command | Expected Result |
| --- | --- | --- |
| TypeScript compile | `npm run compile` | No TypeScript errors |
| Parser fixtures | `npm run test:parser` | `resultParser fixtures passed` |
| Details fixtures | `npm run test:details` | `details fixtures passed` |
| Integration scaffold | `npm run test:integration` | `integration scaffold passed` |
| Bundle | `npm run bundle` | `dist/extension.js` and sourcemap are created |
| Package | `npm run package` | `.vsix` is created |
| Dependency licenses | `npm run deps:check` | License summary is printed for review |

## Manual F5 Checks

These checks require the VS Code Extension Development Host.

| Check | Expected Result |
| --- | --- |
| Open sample workspace | Testing sidebar shows `sample-workspace` root |
| Discovery | `features/login.feature` appears under the workspace root |
| Scenario tree | Feature, scenarios, Scenario Outline examples, and steps are visible |
| Run all | Passing and failing tests update in Test Explorer |
| Run feature | Only the feature target is executed |
| Run scenario | `Successful login` passes and `Failed login` fails |
| Run example row | One Scenario Outline example row is executed via its Examples table line |
| Output channel | `Cucumber Runner` contains stdout/stderr and structured summary |
| Failed step details | Details include status, duration, error, stack trace, and attachment log |
| Copy details | Clipboard contains readable details text |
| Reveal source | `.feature` opens at the scenario/example/step line |
| Open report | Generated `.cucumber-report.ndjson` opens when report format is `message` |

## Known Risks

- Testing item context menu depends on VS Code's `testing/item/context` contribution point. Use active-editor fallback if the item is not passed.
- Full Extension Host automation can be environment-sensitive on Windows. `RUN_VSCODE_INTEGRATION=1` should be verified on a release machine.
- JSON report parsing is not implemented; message NDJSON is the supported structured format.
- `stepDefinitionsPath` is legacy; use `cucumberRunner.steps`.
- Multi-root execution groups targets by workspace folder unless `cucumberRunner.cwd` is explicitly set.

## Placeholders To Replace

- `TODO_PUBLISHER`: replace package publisher. Current valid placeholder: `todo-publisher`.
- `TODO_REPOSITORY_URL`: replace `package.json.repository.url`.
- `TODO_DISPLAY_NAME`: confirm `package.json.displayName`.
- `TODO_ICON`: add `icon` to `package.json` only after an icon file exists.
- `TODO_SCREENSHOT`: add Marketplace screenshots.

## Manual-Only Checks

- Visual Testing sidebar layout and context menu placement.
- Webview appearance in light/dark themes.
- Real user Cucumber projects with custom World objects, hooks, and attachments.
- Marketplace listing preview after publisher/repository/icon updates.
