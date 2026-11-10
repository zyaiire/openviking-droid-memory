/**
 * Structured debug logger for the Droid hooks and the MCP proxy.
 *
 * Activation: OPENVIKING_DEBUG=1 or `debug: true` in the config layers.
 * Log path:   OPENVIKING_DEBUG_LOG or ~/.openviking/logs/droid-hooks.log.
 * Format:     JSON Lines, { ts, hook, stage, data } | { ts, hook, stage, error }.
 */

import { loadConfig } from "./config.mjs";
import { createLogger as createSharedLogger } from "./shared/debug-log.mjs";

let _cfg;
function cfg() {
  if (!_cfg) _cfg = loadConfig();
  return _cfg;
}

export function createLogger(hookName, overrideCfg) {
  return createSharedLogger(hookName, overrideCfg || cfg());
}
