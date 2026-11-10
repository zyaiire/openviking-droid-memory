/**
 * Persistent OpenViking session helpers for the Droid hooks.
 *
 * The OV session id is derived from the Droid session id, so resume and every
 * hook of one session target the same OV session: `dr-<droid session id>`.
 * A fork is a new Droid session and gets its own OV session.
 */

import {
  commitAgentSession,
  enqueueAgentPending,
  getAgentSession,
  getAgentSessionContext,
  makeAgentFetchJSON,
} from "../shared/agent-hook-runtime.mjs";
import { isRetryableFailure } from "../shared/retryable.mjs";
import { deriveHarnessSessionId } from "../shared/session-model.mjs";

export const OV_SESSION_PREFIX = "dr-";

export {
  enqueueAgentPending as enqueuePendingDirectly,
  getAgentSession as getSession,
  getAgentSessionContext as getSessionContext,
  isRetryableFailure,
};

export function deriveOvSessionId(droidSessionId, suffix = "") {
  return deriveHarnessSessionId(OV_SESSION_PREFIX, droidSessionId, suffix);
}

/** A fetchJSON closure; `timeoutKey` picks the per-hook budget from cfg. */
export function makeFetchJSON(cfg, timeoutKey = "timeoutMs") {
  return makeAgentFetchJSON(cfg, process.cwd(), {
    defaultTimeoutMs: cfg[timeoutKey] || cfg.timeoutMs || 10000,
    // Every call here names the peer it wants.
    getActorPeerId: () => "",
  }).fetchJSON;
}

/** Commit (archive + background extract). A no-op on the server when nothing is pending. */
export function commitSession(fetchJSON, sessionId, log, payload = {}) {
  return commitAgentSession(fetchJSON, sessionId, log, payload);
}
