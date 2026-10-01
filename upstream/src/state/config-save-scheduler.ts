import { saveConfig } from "../data/config/store";
import type { AppConfig } from "../types/config";
import { debugLog } from "../utils/debug-log";
import { measurePerfAsync } from "../utils/perf-marks";
import {
  CONFIG_SAVE_DEBOUNCE_MS,
  createPersistScheduler,
} from "./persist-scheduler";

const log = debugLog.createLogger("persist");

type ConfigSource = AppConfig | (() => AppConfig);

function resolveConfig(source: ConfigSource): AppConfig {
  return typeof source === "function" ? source() : source;
}

const configSaveScheduler = createPersistScheduler<ConfigSource>({
  delayMs: CONFIG_SAVE_DEBOUNCE_MS,
  save: (source) => measurePerfAsync("persist.config.save", () => saveConfig(resolveConfig(source))),
  onError: (error) => {
    log.warn("config.save.failed", { error: error instanceof Error ? error.message : String(error) });
  },
});

/**
 * A function source is resolved when the write happens, so a caller that
 * schedules often (every cursor move updates recent tickers) can defer the
 * cost of assembling the config until it is actually persisted, and a longer
 * delay keeps such a save from queueing behind every keystroke.
 */
export function scheduleConfigSave(config: ConfigSource, options: { delayMs?: number } = {}): void {
  configSaveScheduler.schedule(config, options.delayMs);
}

export async function saveConfigImmediately(config: AppConfig): Promise<void> {
  await configSaveScheduler.saveImmediately(config);
}
