/**
 * The shell of a capture hook: gate on autoCapture, detach so Droid is not
 * kept waiting (writePathAsync), then run one capture pass in the worker.
 */

import { isPluginEnabled, loadConfig } from "../config.mjs";
import { createLogger } from "../debug-log.mjs";
import { runHookStage } from "../shared/agent-hook-runtime.mjs";
import { maybeDetach, readHookStdin } from "../shared/async-writer.mjs";
import { runCapture } from "./capture.mjs";
import { silentEnvelope } from "./envelope.mjs";
import { makeFetchJSON } from "./ov-session.mjs";

export async function runCaptureHook(hookName, commit) {
  if (!isPluginEnabled()) return;
  const baseCfg = loadConfig();
  const { log, logError } = createLogger(hookName);
  try {
    if (!baseCfg.autoCapture) {
      log("skip", { reason: "disabled" });
      return;
    }
    if (await maybeDetach(baseCfg, { approve: silentEnvelope })) return;

    const fetchJSON = makeFetchJSON(baseCfg, "captureTimeoutMs");
    await runHookStage({
      loadConfig,
      input: { read: readHookStdin, tolerant: true },
      gates: { enabled: (cfg) => cfg.autoCapture },
      envelope: silentEnvelope,
      onSkip: (reason) => log("skip", { reason }),
    }, ({ cfg, input, cwd, sessionId }) => runCapture({ cfg, input, sessionId, cwd, fetchJSON, log, logError, commit }));
  } catch (err) {
    logError("uncaught", err);
  }
}
