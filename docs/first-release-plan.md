# First Release Plan

Use this plan for the first `0.0.1` preview release.

## F5 Verification

1. Open this extension repository in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` and start the Extension Development Host.
5. In the Extension Development Host, open `sample-workspace`.
6. In `sample-workspace`, run `npm install`.
7. Set:

```json
"cucumberRunner.features": ["features/**/*.feature"],
"cucumberRunner.command": "npx cucumber-js",
"cucumberRunner.reportFormat": "message",
"cucumberRunner.reportOutputPath": "./.cucumber-report.ndjson"
```

Expected results:

- Testing sidebar shows `sample-workspace`.
- `features/login.feature` appears.
- Scenarios, Scenario Outline example rows, and steps are visible.
- Passing scenario passes.
- Failing scenario fails.
- Failed step details show error, stack trace, and attachment log.
- `Cucumber: Copy Details` writes readable text to the clipboard.
- `Cucumber: Reveal Source` opens the `.feature` file at the right line.

## Install VSIX Locally

1. Run:

```bash
npm run package
```

2. Install the generated VSIX:

```bash
code --install-extension cucumber-runner-0.0.1.vsix
```

3. Reload VS Code and open `sample-workspace`.

## Replace Release Metadata

Before publishing:

- Replace `TODO_PUBLISHER`: set `package.json.publisher` to your Marketplace publisher id.
- Replace `TODO_REPOSITORY_URL`: set `package.json.repository.url` to the real repository URL.
- Confirm `TODO_DISPLAY_NAME`: verify `package.json.displayName`.
- Replace `TODO_ICON`: add an icon file and `package.json.icon` only after the file exists.
- Replace `TODO_SCREENSHOT`: add Marketplace screenshots to README or the Marketplace listing.

## Create A Visual Studio Marketplace Publisher

1. Sign in to the Visual Studio Marketplace publisher portal.
2. Create a publisher id.
3. Use that id as `package.json.publisher`.
4. Create or obtain a Personal Access Token with Marketplace publishing rights.
5. Login with:

```bash
npx vsce login <publisher>
```

## Package

```bash
npm run compile
npm run test:parser
npm run test:details
npm run test:integration
npm run bundle
npm run deps:check
npm run package
```

Expected result:

- `cucumber-runner-0.0.1.vsix` is created.
- VSIX contains `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.

## Publish

After metadata replacement and manual verification:

```bash
npx vsce publish
```

Or publish the already packaged VSIX:

```bash
npx vsce publish --packagePath cucumber-runner-0.0.1.vsix
```

## Rollback Plan

If the published extension is broken:

1. Unpublish or hide the problematic version from Marketplace if needed.
2. Publish a patch version, for example `0.0.2`, with the fix.
3. Add the issue and fix to `CHANGELOG.md`.
4. Tell users to update or install the previous local VSIX if a marketplace rollback is delayed.
5. Keep `0.0.1` tagged in source control for reproducibility.
