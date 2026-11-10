#!/usr/bin/env node

/**
 * UserPromptSubmit hook for Droid.
 *
 * Searches OpenViking for context relevant to the prompt and injects one
 * <openviking-context> block. Retrieval, ranking and the token budget are the
 * shared recall core's. Droid does not fire this hook under `droid exec`.
 */

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { contextEnvelope } from "./lib/envelope.mjs";
import { deriveOvSessionId, makeFetchJSON } from "./lib/ov-session.mjs";
import { getEffectivePeerId } from "./lib/workspace-peer.mjs";
import { runHookStage } from "./shared/agent-hook-runtime.mjs";
import { applyInputFilters, compileInputFilters } from "./shared/input-filters.mjs";
import { buildRecallBlockDetailed } from "./shared/recall-core.mjs";

if (!isPluginEnabled()) process.exit(0);

const { log, logError } = createLogger("auto-recall");
const fetchJSON = makeFetchJSON(loadConfig());

runHookStage({
  loadConfig,
  gates: { enabled: (cfg) => cfg.autoRecall },
  envelope: contextEnvelope("UserPromptSubmit"),
  onSkip: (reason) => log("skip", { reason }),
}, async ({ cfg, input, cwd, sessionId }) => {
  let prompt = String(input.prompt || "").trim();
  const peer = getEffectivePeerId(cfg, { sessionId, cwd });
  log("start", {
    queryLength: prompt.length,
    recallLimit: cfg.recallLimit,
    recallTokenBudget: cfg.recallTokenBudget,
    peerSource: peer.source,
  });

  // Filters run before the length gate, so a prompt whose only content was a
  // stripped prefix is a short query rather than a search for nothing.
  const queryFilters = compileInputFilters(cfg.recallQueryFilters);
  if (queryFilters.rules.length) {
    const verdict = applyInputFilters(prompt, queryFilters.rules, { role: "user" });
    if (verdict.dropped) {
      log("skip", { reason: "query_filter", rule: verdict.ruleIndex, op: verdict.op });
      return;
    }
    prompt = verdict.text;
  }
  if (queryFilters.errors.length) log("query_filter_errors", queryFilters.errors);
  if (!prompt || prompt.length < cfg.minQueryLength) {
    log("skip", { reason: "short_query" });
    return;
  }

  const health = await fetchJSON("/health");
  if (!health.ok) {
    logError("health_check", "server unreachable");
    return;
  }

  // The OV session id turns on server-side query expansion and the cross-turn
  // dedup ledger; it must match the id the capture hooks write to.
  const recalled = await buildRecallBlockDetailed(fetchJSON, cfg, prompt, {
    actorPeerId: peer.peerId,
    legacyPeerId: peer.legacyPeerId,
    sessionId: sessionId ? deriveOvSessionId(sessionId) : "",
    log,
    localCompressorAvailable: false,
    excludeUris: cfg.recallExcludeUris,
  });
  if (!recalled.block) {
    log("skip", { reason: recalled.stage });
    return;
  }
  log("inject", {
    stage: recalled.stage,
    contentItems: recalled.contentCount,
    hintItems: recalled.hintCount,
    tokens: recalled.budgetUsed,
  });
  return recalled.block;
}).catch((err) => { logError("uncaught", err); });
