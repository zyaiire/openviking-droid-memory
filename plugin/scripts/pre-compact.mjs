#!/usr/bin/env node

/**
 * PreCompact hook for Droid: capture any turns not yet sent, then commit, so
 * OpenViking archives the window `/compress` is about to summarize.
 */

import { runCaptureHook } from "./lib/capture-entry.mjs";

await runCaptureHook("pre-compact", "always");
