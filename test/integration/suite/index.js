const assert = require('assert');
const vscode = require('vscode');

async function run() {
  const sampleWorkspace = process.env.SAMPLE_WORKSPACE;
  assert.ok(sampleWorkspace, 'SAMPLE_WORKSPACE should be provided');
  vscode.workspace.updateWorkspaceFolders(
    0,
    vscode.workspace.workspaceFolders?.length ?? 0,
    { uri: vscode.Uri.file(sampleWorkspace), name: 'sample-workspace' }
  );
  await new Promise((resolve) => setTimeout(resolve, 500));

  const extension = vscode.extensions.getExtension('todo-publisher.cucumber-runner');
  assert.ok(extension, 'Extension should be available in the extension host');

  const api = await extension.activate();
  assert.ok(api?.controller, 'Extension should expose a TestController for integration tests');

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('cucumberRunner.refreshTests'));
  assert.ok(commands.includes('cucumberRunner.runAll'));
  assert.ok(commands.includes('cucumberRunner.showItemDetails'));

  await vscode.commands.executeCommand('cucumberRunner.refreshTests');
  await api.refreshTests();

  let itemCount = 0;
  api.controller.items.forEach((workspaceItem) => {
    itemCount += 1;
    workspaceItem.children.forEach(() => {
      itemCount += 1;
    });
  });

  assert.ok(itemCount > 0, 'Discovery should create at least one TestItem for the sample workspace');
}

module.exports = { run };
