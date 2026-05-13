export function cucumberUriMatchesItemPath(
  itemFsPath: string | undefined,
  resultUri: string | undefined,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  if (!itemFsPath || !resultUri) {
    return false;
  }

  const itemPath = normalizeComparablePath(itemFsPath, platform);
  const resultPath = normalizeComparablePath(resultUri, platform);
  if (!itemPath || !resultPath) {
    return false;
  }

  if (isAbsolutePathLike(resultUri)) {
    return itemPath === resultPath;
  }

  return itemPath === resultPath || itemPath.endsWith(`/${resultPath}`);
}

function normalizeComparablePath(value: string, platform: NodeJS.Platform | string): string {
  let normalized = value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');

  if (platform === 'win32') {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function isAbsolutePathLike(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\/.test(value) ||
    /^\//.test(value)
  );
}
