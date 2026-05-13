import * as fs from 'fs';

export interface RunGroup {
  cwd: string;
  targets: string[];
}

export type RealpathFn = (filePath: string) => Promise<string>;

export async function canonicalizeCwd(cwd: string, realpath: RealpathFn = nativeRealpath): Promise<string> {
  try {
    return await realpath(cwd);
  } catch {
    return cwd;
  }
}

export async function canonicalizeRunGroups(
  groups: RunGroup[],
  realpath: RealpathFn = nativeRealpath
): Promise<RunGroup[]> {
  return Promise.all(groups.map(async (group) => ({
    cwd: await canonicalizeCwd(group.cwd, realpath),
    targets: group.targets
  })));
}

function nativeRealpath(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.realpath.native(filePath, (error, resolvedPath) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(resolvedPath);
    });
  });
}
