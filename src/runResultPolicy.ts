import { normalizeCucumberTarget } from './commandBuilder';

export function noMatchedScenariosMessage(targets: readonly string[], cwd: string): string {
  const targetList = targets.map((target) => normalizeCucumberTarget(target, cwd)).join(', ');
  return `No Cucumber scenarios matched target ${targetList}`;
}
