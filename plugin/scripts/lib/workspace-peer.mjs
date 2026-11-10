import { readJsonState, writeJsonState } from "./state.mjs";
import { resolveEffectivePeerId } from "../shared/workspace-peer.mjs";

// A pin freezes one session's peer for its whole lifetime. Bump this whenever
// the derivation changes; entries stamped with anything else are re-derived.
export const PIN_VERSION = 3;

function stateName(sessionId) {
  const safe = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `droid-ws-peer-${safe}.json`;
}

/**
 * The session's workspace peer, pinned on first resolution so a session that
 * changes directory keeps writing to the peer it started with.
 */
export function getEffectivePeerId(cfg, { sessionId = "", cwd = "" } = {}) {
  if (!sessionId) return resolveEffectivePeerId({ cfg, cwd });

  const name = stateName(sessionId);
  const cached = readJsonState(name);
  if (cached?.version === PIN_VERSION && cached?.peerId && cached?.source) {
    if (String(cfg.peerId || "").trim()) return resolveEffectivePeerId({ cfg, cwd });
    if (cached.source === "workspace" && cfg.workspacePeer !== false) {
      return {
        peerId: String(cached.peerId),
        source: "workspace",
        origin: String(cached.origin || "workspace"),
        legacyPeerId: String(cached.legacyPeerId || ""),
      };
    }
  }

  const resolved = resolveEffectivePeerId({ cfg, cwd });
  if (resolved.source === "workspace") {
    writeJsonState(name, {
      version: PIN_VERSION,
      peerId: resolved.peerId,
      source: resolved.source,
      origin: resolved.origin,
      legacyPeerId: resolved.legacyPeerId,
      cwd: String(cwd || ""),
    });
  }
  return resolved;
}
