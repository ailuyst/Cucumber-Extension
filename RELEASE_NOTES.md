# Release Notes 0.0.1

## Summary

Initial preview release of Cucumber Runner for VS Code.

## Features

- Discover Cucumber/Gherkin `.feature` files in Test Explorer.
- Run all tests, features, scenarios, Scenario Outlines, and Scenario Outline example rows.
- Parse Cucumber message NDJSON reports for scenario and step-level results.
- Show step duration, failures, stack traces, and attachments/logs.
- Open safe Webview details for scenarios, example rows, and steps.
- Copy details and reveal source from Testing item context menu.

## Known Limitations

- JSON report parsing is not implemented; use `reportFormat: "message"` for structured results.
- `stepDefinitionsPath` is reserved for future use.
- Testing item context menu support depends on the VS Code version; active editor fallback is available.
- Full Testing sidebar UI verification is manual for this preview.

## Installation

Install the generated VSIX:

```bash
code --install-extension cucumber-runner-0.0.1.vsix
```

Recommended setting for step-level results:

```json
"cucumberRunner.reportFormat": "message"
```

## Feedback

Please report issues with:

- VS Code version.
- Cucumber command.
- `cucumberRunner.*` settings.
- A minimal `.feature` file and redacted message report if possible.
