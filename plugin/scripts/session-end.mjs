#!/usr/bin/env node

/**
 * SessionEnd hook for Droid: capture any turns not yet sent, then commit.
 * `droid exec`, `/exit` and Ctrl-C all fire it.
 */

import { runCaptureHook } from "./lib/capture-entry.mjs";

await runCaptureHook("session-end", "always");
