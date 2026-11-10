#!/usr/bin/env node

/**
 * Stop hook for Droid: send the turns since the last capture to the session's
 * OV session, and commit once its pending tokens reach commitTokenThreshold.
 */

import { runCaptureHook } from "./lib/capture-entry.mjs";

await runCaptureHook("auto-capture", "threshold");
