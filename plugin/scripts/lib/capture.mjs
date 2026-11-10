/**
 * The capture pass shared by the Stop, PreCompact and SessionEnd hooks.
 *
 * Under the per-session lock: decode `transcript_path`, send the turns after
 * the cursor, advance the cursor, then commit — always for PreCompact and
 * SessionEnd, on Stop only once the OV session's pending tokens reach
 * `commitTokenThreshold`. SessionEnd follows Stop within ~100 ms under
 * `droid exec`, so the lock is what keeps the final commit behind the last
 * turn.
 */

import { readFile } from "node:fs/promises";

import { CLIENT_ID } from "../config.mjs";
import { decodeDroidTranscript } from "../droid-transcript.mjs";
import {
  addAgentMessages,
  readHookState,
  withAgentHookLock,
  writeHookState,
} from "../shared/agent-hook-runtime.mjs";
import { shouldCaptureText } from "../shared/capture-utils.mjs";
import { replayPending } from "../shared/pending-queue.mjs";
import { commitSession, deriveOvSessionId, getSession } from "./ov-session.mjs";
import { getEffectivePeerId } from "./workspace-peer.mjs";

const ACK_LIMIT = 1000;
const FINAL_LOCK_ATTEMPTS = 5;

// Keyword mode sends a batch only when some user turn carries one of these.
const MEMORY_TRIGGERS = [
  /remember|preference|prefer|important|decision|decided|always|never/i,
  /记住|偏好|喜欢|喜爱|崇拜|讨厌|害怕|重要|决定|总是|永远|优先|习惯|爱好|擅长|最爱|不喜欢/i,
  /[\w.-]+@[\w.-]+\.\w+/,
  /\+\d{10,}/,
  /(?:我|my)\s*(?:是|叫|名字|name|住在|live|来自|from|生日|birthday|电话|phone|邮箱|email)/i,
  /(?:我|i)\s*(?:喜欢|崇拜|讨厌|害怕|擅长|不会|爱|恨|想要|需要|希望|觉得|认为|相信)/i,
  /(?:favorite|favourite|love|hate|enjoy|dislike|admire|idol|fan of)/i,
];

export function turnDedupKey(turn) {
  return `${turn.turnId}:${turn.role}`;
}

/** Turns after the last occurrence of `lastTurnId`; the whole chain when it is gone (rewind / edit). */
export function selectNewTurns(turns, state = {}) {
  if (!state.lastTurnId) return { turns, rescanned: false };
  const at = turns.map((turn) => turn.turnId).lastIndexOf(state.lastTurnId);
  return at >= 0 ? { turns: turns.slice(at + 1), rescanned: false } : { turns, rescanned: true };
}

/**
 * Split candidate turns into what to send and what to acknowledge unsent
 * (filtered out, or assistant turns when `captureAssistantTurns` is off).
 * Already-acknowledged turns are neither.
 */
export function buildCapturePlan(turns, state = {}, cfg = {}) {
  const acknowledged = new Set(Array.isArray(state.capturedTurnIds) ? state.capturedTurnIds : []);
  const toSend = [];
  const skipped = [];
  for (const turn of turns) {
    const key = turnDedupKey(turn);
    if (acknowledged.has(key)) continue;
    if (turn.role === "assistant" && cfg.captureAssistantTurns === false) {
      skipped.push(key);
      continue;
    }
    const decision = shouldCaptureText(turn.content, turn.role, cfg);
    if (!decision.shouldCapture) {
      skipped.push(key);
      continue;
    }
    toSend.push({ key, turn, payload: { role: turn.role, content: decision.text, turn_id: turn.turnId } });
  }
  if (cfg.captureMode === "keyword" && toSend.length
    && !toSend.some(({ turn, payload }) => turn.role === "user" && MEMORY_TRIGGERS.some((re) => re.test(payload.content)))) {
    return { toSend: [], skipped: [...skipped, ...toSend.map(({ key }) => key)], keywordMiss: true };
  }
  return { toSend, skipped, keywordMiss: false };
}

/**
 * The state after a send: the first `captured` payloads (sent or queued, a
 * contiguous prefix) and every skipped turn are acknowledged, and the cursor
 * moves to the last turn of the unbroken acknowledged run.
 */
export function applyCaptureResult(state, turns, plan, captured) {
  const acknowledged = new Set(Array.isArray(state.capturedTurnIds) ? state.capturedTurnIds : []);
  for (const key of plan.skipped) acknowledged.add(key);
  for (const item of plan.toSend.slice(0, captured)) acknowledged.add(item.key);

  let cursor = null;
  for (const turn of turns) {
    if (!acknowledged.has(turnDedupKey(turn))) break;
    cursor = turn.turnId;
  }
  return {
    ...state,
    capturedTurnIds: [...acknowledged].slice(-ACK_LIMIT),
    lastTurnId: cursor || state.lastTurnId || null,
    hasMessages: Boolean(state.hasMessages || captured > 0),
  };
}

async function readTranscript(path, log) {
  if (!path) {
    log("capture_missing", { reason: "no transcript_path" });
    return null;
  }
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    log(err?.code === "ENOENT" ? "capture_missing" : "capture_unreadable", { path, code: err?.code });
    return null;
  }
}

async function capturePass(ctx, state) {
  const { cfg, input, sessionId, cwd, fetchJSON, log, logError, ovSessionId } = ctx;
  const text = await readTranscript(input.transcript_path, log);
  if (text == null) return { state, sent: 0 };

  const decoded = decodeDroidTranscript(text);
  if (!decoded.ok) {
    log("capture_unknown_format", { version: decoded.version ?? null });
    return { state, sent: 0 };
  }

  const selected = selectNewTurns(decoded.turns, state);
  const plan = buildCapturePlan(selected.turns, state, cfg);
  log("transcript_parse", {
    chainTurns: decoded.turns.length,
    newTurns: selected.turns.length,
    rescanned: selected.rescanned,
    toSend: plan.toSend.length,
    skipped: plan.skipped.length,
    keywordMiss: plan.keywordMiss || undefined,
  });
  if (plan.toSend.length === 0) {
    return { state: applyCaptureResult(state, selected.turns, plan, 0), sent: 0 };
  }

  const health = await fetchJSON("/health");
  if (health.ok) {
    try {
      await replayPending(fetchJSON, log, { consumeRetries: false });
    } catch (err) {
      logError("pending-replay", err);
    }
  }

  const peer = getEffectivePeerId(cfg, { sessionId, cwd });
  const res = await addAgentMessages(fetchJSON, ovSessionId, plan.toSend.map(({ payload }) => payload), peer.peerId);
  const captured = Math.min(plan.toSend.length, Number(res.sent || 0) + Number(res.queued || 0));
  log("push_turns", {
    ovSessionId,
    sent: res.sent,
    queued: res.queued,
    failed: res.failed,
    enqueueFailed: res.enqueueFailed,
    error: res.lastError ? String(res.lastError.message || res.lastError.code || res.lastError) : undefined,
  });
  return { state: applyCaptureResult(state, selected.turns, plan, captured), sent: Number(res.sent || 0) };
}

async function maybeCommit(ctx, state, sent) {
  const { cfg, fetchJSON, log, ovSessionId, commit } = ctx;
  if (!state.hasMessages) {
    log("commit_skipped", { ovSessionId, reason: "nothing captured in this session" });
    return;
  }
  if (commit === "always") {
    await commitSession(fetchJSON, ovSessionId, log);
    return;
  }
  if (sent <= 0) return;
  const meta = await getSession(fetchJSON, ovSessionId);
  const pending = Number(meta?.pending_tokens || 0);
  log("pending_tokens", { ovSessionId, pending, threshold: cfg.commitTokenThreshold });
  if (pending >= cfg.commitTokenThreshold) {
    await commitSession(fetchJSON, ovSessionId, log, { keep_recent_count: 0 });
  }
}

/**
 * One capture pass plus the commit decision, under the session lock.
 * `commit` is "threshold" (Stop) or "always" (PreCompact, SessionEnd). A final
 * pass retries the lock so it waits out a Stop pass still sending.
 */
export async function runCapture({ cfg, input, sessionId, cwd, fetchJSON, log, logError, commit }) {
  if (!sessionId) {
    log("skip", { reason: "no session_id" });
    return;
  }
  const ctx = { cfg, input, sessionId, cwd, fetchJSON, log, logError, commit, ovSessionId: deriveOvSessionId(sessionId) };
  log("start", { event: input.hook_event_name, sessionId, ovSessionId: ctx.ovSessionId, commit });

  const attempts = commit === "always" ? FINAL_LOCK_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const done = await withAgentHookLock(CLIENT_ID, sessionId, async () => {
      const before = await readHookState(CLIENT_ID, sessionId);
      const { state, sent } = await capturePass(ctx, before);
      await writeHookState(CLIENT_ID, sessionId, state);
      await maybeCommit(ctx, state, sent);
      return true;
    });
    if (done) return;
    log("lock_busy", { attempt, attempts });
  }
}
