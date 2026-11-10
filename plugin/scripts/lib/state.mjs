/**
 * Small JSON state files under ~/.openviking/state/ (or $OPENVIKING_HOME/state).
 *
 * Atomic write: temp file + rename. Stale entries (older than maxAgeMs) read
 * as null. The directory is shared with the other OpenViking hosts, so every
 * name written here is either Droid-prefixed or keyed by a Droid session id.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OV_HOME = process.env.OPENVIKING_HOME && process.env.OPENVIKING_HOME.trim()
  ? process.env.OPENVIKING_HOME.replace(/^~(?=$|\/)/, homedir())
  : join(homedir(), ".openviking");
export const STATE_DIR = join(OV_HOME, "state");

export function statePath(name) {
  return join(STATE_DIR, name);
}

export function writeJsonState(name, payload) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch { /* the write below reports nothing either */ }
  const target = statePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ ...payload, ts: payload?.ts ?? Date.now() }));
    renameSync(tmp, target);
  } catch { /* best effort */ }
}

export function readJsonState(name, { maxAgeMs } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(statePath(name), "utf-8"));
  } catch {
    return null;
  }
  if (maxAgeMs && typeof parsed?.ts === "number" && Date.now() - parsed.ts > maxAgeMs) return null;
  return parsed;
}
