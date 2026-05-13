import { CucumberStepResult, formatCucumberStepLabel } from './resultParser';
import { DiscoveredHook } from './hookDiscovery';

type RuntimeHookIdentity = Pick<CucumberStepResult, 'hookType' | 'keyword' | 'text' | 'uri' | 'line' | 'hookId'>;

export function runtimeHookItemId(parentId: string, step: RuntimeHookIdentity, executionIndex: number): string {
  return `${runtimeHookItemPrefix(parentId)}${stableHookKey(step)}:${executionIndex}`;
}

export function runtimeHookItemPrefix(parentId: string): string {
  return `hook:${parentId}:`;
}

export function isRuntimeHookItemId(parentId: string, itemId: string): boolean {
  return itemId.startsWith(runtimeHookItemPrefix(parentId));
}

export function staticHookItemId(parentId: string, hook: Pick<DiscoveredHook, 'type' | 'label' | 'uri' | 'line' | 'ordinal'>): string {
  return `${staticHookItemPrefix(parentId)}${encodeURIComponent([
    hook.type,
    hook.label,
    hook.uri ?? '',
    hook.line !== undefined ? String(hook.line) : '',
    String(hook.ordinal)
  ].map(normalizeKeyPart).join('|'))}`;
}

export function staticHookItemPrefix(parentId: string): string {
  return `hookStatic:${parentId}:`;
}

export function isStaticHookItemId(parentId: string, itemId: string): boolean {
  return itemId.startsWith(staticHookItemPrefix(parentId));
}

export function orderedRuntimeChildren<T extends { id: string }>(
  parentId: string,
  currentOrdered: readonly T[],
  existing: readonly T[]
): T[] {
  const uniqueOrderedItems: T[] = [];
  const orderedIds = new Set<string>();
  const existingIds = new Set(existing.map((item) => item.id));

  for (const item of currentOrdered) {
    if (!orderedIds.has(item.id) && existingIds.has(item.id)) {
      uniqueOrderedItems.push(item);
      orderedIds.add(item.id);
    }
  }

  const remaining = existing.filter((item) => !orderedIds.has(item.id) && !isRuntimeHookItemId(parentId, item.id));
  return [...uniqueOrderedItems, ...remaining];
}

function stableHookKey(step: RuntimeHookIdentity): string {
  const hasSourceLocation = !!step.uri || step.line !== undefined;
  const parts = [
    step.hookType ?? 'hook',
    formatCucumberStepLabel(step),
    step.uri ?? '',
    step.line !== undefined ? String(step.line) : '',
    hasSourceLocation ? '' : step.hookId ?? ''
  ];
  return encodeURIComponent(parts.map(normalizeKeyPart).join('|'));
}

function normalizeKeyPart(value: string): string {
  return value.replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}
