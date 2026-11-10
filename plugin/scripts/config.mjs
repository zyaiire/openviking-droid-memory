/**
 * Configuration for the Droid OpenViking memory plugin.
 *
 * Every knob is declared in `shared/config-schema.mjs` and assembled by
 * `buildPluginConfig("droid")`, which reads, highest first:
 *
 *   env (OPENVIKING_*) → workspace `.openviking/config*.json` and the machine
 *   registry → ovcli.conf `plugin.droid` → ovcli.conf `plugin` →
 *   ov.conf's `droid` section → the schema's defaults
 *
 * Enable/disable:
 *   - OPENVIKING_MEMORY_ENABLED env var (0/false/no = off, 1/true/yes = on)
 *   - droid.enabled in ov.conf (false = off)
 *   - Fallback: enabled when ov.conf or ovcli.conf exists, disabled otherwise
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import { buildPluginConfig } from "./shared/plugin-config.mjs";

export const CLIENT_ID = "droid";

const DEFAULT_OV_CONF_PATH = join(homedir(), ".openviking", "ov.conf");
const DEFAULT_OVCLI_CONF_PATH = join(homedir(), ".openviking", "ovcli.conf");
const MANIFEST_URL = new URL("../.factory-plugin/plugin.json", import.meta.url);

function envBool(name) {
  const v = process.env[name];
  if (v == null || v === "") return undefined;
  const lower = v.trim().toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no") return false;
  if (lower === "1" || lower === "true" || lower === "yes") return true;
  return undefined;
}

function tryLoadJsonFile(envVar, defaultPath) {
  const configPath = resolvePath((process.env[envVar] || defaultPath).replace(/^~/, homedir()));
  try {
    return { configPath, file: JSON.parse(readFileSync(configPath, "utf-8")) };
  } catch {
    return null;
  }
}

export function isPluginEnabled() {
  const envEnabled = envBool("OPENVIKING_MEMORY_ENABLED");
  if (envEnabled !== undefined) return envEnabled;

  const ovConf = tryLoadJsonFile("OPENVIKING_CONFIG_FILE", DEFAULT_OV_CONF_PATH);
  if (ovConf) return ovConf.file?.droid?.enabled !== false;

  return Boolean(tryLoadJsonFile("OPENVIKING_CLI_CONFIG_FILE", DEFAULT_OVCLI_CONF_PATH));
}

/**
 * `cwd` selects the workspace layer. A hook loads once against its own
 * directory and again against the payload's `cwd`; connection and credential
 * keys never come from a workspace file, so fetch helpers built from the first
 * load stay valid.
 */
export function loadConfig(cwd = process.cwd(), { env = process.env } = {}) {
  const config = buildPluginConfig(CLIENT_ID, {
    cwd,
    env,
    manifestUrl: MANIFEST_URL,
    logFile: "droid-hooks.log",
    rootKeyFallback: true,
  });
  return {
    ...config,
    configPath: config.ovPath || config.cliPath || null,
    credentialPath: config.credentialPath || null,
  };
}
