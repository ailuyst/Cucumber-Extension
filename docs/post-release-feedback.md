# Post-Release Feedback

Use this checklist when gathering feedback from the first preview users.

## Performance

- Does discovery complete quickly on small and medium projects?
- Does the file watcher avoid noisy refreshes while editing feature files?
- Does running a single scenario feel responsive?
- Does the OutputChannel become too noisy on repeated runs?

## Discovery Correctness

- Are all `.feature` files from `cucumberRunner.features` discovered?
- Do nested folders appear correctly?
- Are Feature, Scenario, Scenario Outline, Example rows, and Steps named correctly?
- Are line numbers correct when revealing source?
- Are multi-root workspaces discovered per workspace folder?

## Testing Sidebar UX

- Is the tree structure understandable?
- Are run actions discoverable?
- Does right-click context menu work on supported VS Code versions?
- Is the active-editor fallback useful when context menu data is unavailable?

## Scenario Outline Behavior

- Are Examples rows shown as separate TestItems?
- Does running a specific example row execute the expected `file.feature:line`?
- Are results mapped to the right example row?
- Are long example values readable without overwhelming the tree?

## Logs and Details

- Is the OutputChannel enough for quick debugging?
- Does the details panel show the failed step, error, stack trace, logs, duration, and source line?
- Is copy details useful for issue reports?
- Are stdout/stderr and Cucumber attachments shown clearly?

## VS Code Compatibility

- Which VS Code version is being used?
- Does the Testing sidebar context menu appear?
- Does F5 Extension Development Host work?
- Does installing the VSIX work?

## Cucumber Compatibility

- Which Cucumber implementation and version is used?
- Does `--format message:<path>` work?
- Does stdout fallback still produce a reasonable pass/fail status?
- Are custom Cucumber commands and project-local binaries handled correctly?

## Conflicts With Official Cucumber Extension

- Does syntax highlighting continue to work?
- Does autocomplete/language-server behavior remain owned by the official extension?
- Are there command or activation conflicts?
- Does this extension avoid changing formatting or Gherkin language features?

## Feedback Template

Ask users to include:

- OS and VS Code version
- Cucumber package/version
- Extension version
- `cucumberRunner.*` settings
- Command run
- Expected result
- Actual result
- Relevant OutputChannel text
- Redacted `.feature` snippet when useful
