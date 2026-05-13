# Cucumber Runner Sample Workspace

This workspace is intentionally small and uses TypeScript step definitions for smoke-testing the extension.

The sample compiles TypeScript step definitions to `dist/` before running Cucumber. Cucumber loads the compiled JavaScript files from `dist/step_definitions`, not the `.ts` files directly. This avoids `ts-node` and prevents duplicate Cucumber instance errors such as:

```text
You're calling functions (e.g. "Given") on an instance of Cucumber that isn't running
```

## Run

```bash
npm install
npm run build
npx cucumber-js --config cucumber.cjs
npx cucumber-js --config cucumber.cjs features/login.feature:3
npx cucumber-js --config cucumber.cjs --format message:reports/cucumber.ndjson
```

The `reports/` folder is kept in the sample so message reports can be written during manual extension testing.

## VS Code Extension Smoke Test

Before running tests from the extension Testing sidebar, build the TypeScript steps:

```bash
npm run build
```

The workspace setting keeps the extension command as `npx cucumber-js --config cucumber.cjs` so the Debug profile can launch the project-local Cucumber binary with Node inspector. Rebuild after changing `.ts` step definitions.
