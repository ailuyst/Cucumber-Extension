const path = require('path');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite');
  const sampleWorkspace = path.resolve(__dirname, '..', '..', 'sample-workspace');

  if (process.env.RUN_VSCODE_INTEGRATION !== '1') {
    const featurePath = path.join(sampleWorkspace, 'features', 'login.feature');
    if (!fs.existsSync(featurePath)) {
      throw new Error(`Sample feature is missing: ${featurePath}`);
    }
    if (!fs.existsSync(path.join(extensionTestsPath, 'index.js'))) {
      throw new Error(`Integration suite is missing: ${extensionTestsPath}`);
    }
    console.log('integration scaffold passed');
    console.log('Set RUN_VSCODE_INTEGRATION=1 to launch VS Code Extension Host.');
    return;
  }

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      SAMPLE_WORKSPACE: sampleWorkspace
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
