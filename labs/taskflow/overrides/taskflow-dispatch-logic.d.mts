export const DISPATCH_EXECUTORS: readonly string[];
export const NATIVE_TASK_STATE_LABELS: Readonly<Record<string, string>>;
export function nativeTaskStateKey(item: any): string;
export function nativeTaskStateLabel(item: any): string;
export function normalizeDispatchIssue(issue: any, runs?: any[], now?: number, trustedRuntime?: any): any;
export function hasDispatchEvidence(item: any): boolean;
export function buildPmInboxEntries(items: any[]): any[];
