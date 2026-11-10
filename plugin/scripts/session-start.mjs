#!/usr/bin/env node

/**
 * SessionStart hook for Droid.
 *
 * Injects the user's profile (profile.md plus annotated listings of
 * preferences/ and entities/) and, when `resumeArchiveInject` is on, the
 * OV session's latest archive overview on `resume`. Droid reports `resume` for
 * `-s`, `--fork` and after `/compress` alike, and compaction drops the earlier
 * injection from the model's context, so the profile goes out on every start.
 *
 * Also replays writes parked by earlier hooks while the server was down.
 */

import { CLIENT_ID, isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { contextEnvelope } from "./lib/envelope.mjs";
import { deriveOvSessionId, getSessionContext, makeFetchJSON } from "./lib/ov-session.mjs";
import { writeJsonState } from "./lib/state.mjs";
import { getEffectivePeerId } from "./lib/workspace-peer.mjs";
import { runHookStage } from "./shared/agent-hook-runtime.mjs";
import { replayPending } from "./shared/pending-queue.mjs";
import { buildProfileBlock, estimateTokens, truncateToBytes } from "./shared/profile-inject.mjs";

if (!isPluginEnabled()) process.exit(0);

const { log, logError } = createLogger("session-start");
const fetchJSON = makeFetchJSON(loadConfig());
const emit = contextEnvelope("SessionStart");

function formatArchiveSection(sessionCtx, ovSessionId, maxBytes = 0) {
  let overview = String(sessionCtx?.latest_archive_overview || "").trim();
  if (!overview) return null;
  const truncated = truncateToBytes(overview, maxBytes);
  if (truncated !== overview) {
    overview = `${truncated}\nMore detail: read viking://~/sessions/${ovSessionId}/history/ with the OpenViking MCP read tool.`;
  }
  return ["<session-archive>", `  <archive-overview>${overview}</archive-overview>`, "</session-archive>"].join("\n");
}

runHookStage({
  loadConfig,
  input: { tolerant: true },
  envelope: emit,
  onSkip: (reason) => log("skip", { reason }),
}, async ({ cfg, input, cwd, sessionId }) => {
  const source = input.source || "startup";
  const effectivePeer = getEffectivePeerId(cfg, { sessionId, cwd });
  log("start", { client: CLIENT_ID, source, sessionId, peerSource: effectivePeer.source });

  const willInjectProfile = !cfg.noAutoInject;
  const willInjectArchive = Boolean(cfg.resumeArchiveInject && source === "resume" && sessionId);

  const health = await fetchJSON("/health");
  if (!health.ok) {
    logError("health_check", "server unreachable");
    return;
  }

  try {
    const replayed = await replayPending(fetchJSON, log);
    if (replayed.replayed > 0 || replayed.failed > 0 || replayed.deferred > 0) log("pending-replay", replayed);
  } catch (err) {
    logError("pending-replay", err);
  }

  if (!willInjectProfile && !willInjectArchive) {
    log("skip", { reason: "no_injection_planned", source });
    return;
  }

  // Under a byte cap the archive takes up to half and the profile the rest.
  const maxBytes = cfg.sessionStartMaxBytes || 0;
  let archiveSection = null;
  if (willInjectArchive) {
    const ovSessionId = deriveOvSessionId(sessionId);
    const sessionCtx = await getSessionContext(fetchJSON, ovSessionId, cfg.resumeContextBudget);
    archiveSection = formatArchiveSection(sessionCtx, ovSessionId, Math.floor(maxBytes / 2));
  }

  let profile = null;
  if (willInjectProfile) {
    try {
      const profileMaxBytes = maxBytes > 0
        ? Math.max(1, maxBytes - Buffer.byteLength(archiveSection || "", "utf8") - 100)
        : 0;
      profile = await buildProfileBlock(fetchJSON, cfg.profileTokenBudget, effectivePeer.peerId, {
        ...cfg,
        sessionStartMaxBytes: profileMaxBytes,
      });
    } catch (err) {
      logError("profile_inject", err);
    }
  }

  const sections = [profile?.block, archiveSection].filter(Boolean);
  if (sections.length === 0) {
    log("no_inject", { source, profile: Boolean(profile), archive: Boolean(archiveSection) });
    return;
  }

  const composed = `<openviking-context source="${source}">\n${sections.join("\n")}\n</openviking-context>`;
  writeJsonState("droid-last-inject.json", { source, session_id: sessionId, content: composed });
  log("inject", {
    source,
    chars: composed.length,
    tokens: estimateTokens(composed),
    profile: profile && {
      tokens: profile.tokens,
      prefCount: profile.prefCount,
      entCount: profile.entCount,
    },
    archive: Boolean(archiveSection),
  });
  return composed;
}).catch((err) => { logError("uncaught", err); });
