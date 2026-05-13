export const DEFAULT_CONFIG_FILE = 'cucumber.js';
export const DEFAULT_FEATURE_GLOBS = ['features/**/*.feature'];
export const DEFAULT_STEP_GLOBS = ['src/steps/**/*.ts'];
export const DEFAULT_SUPPORT_GLOBS = ['src/support/**/*.ts'];
export const DEFAULT_COMMAND = 'npx cucumber-js';

export interface CucumberRunnerResolvedConfig {
  configFile: string;
  features: string[];
  steps: string[];
  support: string[];
  command: string;
}

export function normalizeGlobSettings(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const globs = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return globs.length > 0 ? globs : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return fallback;
}
