import { debugLog } from "../utils/debug-log";

/**
 * Runtime health for one plugin, read from its scoped logger. A plugin that
 * registered fine but throws in every capability call is invisible to the load
 * step; its `ctx.log.error` calls are the only trace, and this is what the
 * marketplace shows next to it.
 */
export interface PluginHealth {
  errorCount: number;
  lastError: { message: string; timestamp: number } | null;
}

export function getPluginHealth(pluginId: string): PluginHealth {
  const errors = debugLog.getEntries({ level: "error", source: pluginId });
  const last = errors[errors.length - 1];
  return {
    errorCount: errors.length,
    lastError: last ? { message: last.message, timestamp: last.timestamp } : null,
  };
}
