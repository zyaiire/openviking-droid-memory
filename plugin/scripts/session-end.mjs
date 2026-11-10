#!/usr/bin/env node

/**
 * SessionEnd hook for Droid: capture any turns not yet sent, then commit.
 * Every measured exit (`droid exec`, `/exit`, Ctrl-C) fires it.
 */

import { runCaptureHook } from "./lib/capture-entry.mjs";

await runCaptureHook("session-end", "always");
