/**
 * Decode a Droid session JSONL (`transcript_path`) into conversation turns.
 *
 * Rules (DESIGN.md, "Turn decoding"):
 *   1. Unparsable lines are skipped; the header is the first `session_start`.
 *   2. Conversation records are `message` records with role user/assistant and
 *      neither `visibility` nor `hookEventName`.
 *   3. The main chain runs from the last conversation record in file order up
 *      its `parentId` links, through any message record. Compaction keeps the
 *      links, so pre-compaction turns stay reachable; abandoned branches drop.
 *   4. A fork drops the chain up to and including `forkedAtMessageId`.
 *   5. A turn is one record's joined `text` blocks; `thinking`, `tool_use`,
 *      `tool_result` and images are not turn text, and a record without text
 *      is not a turn. An assistant record without `modelId` is a Droid notice,
 *      not a turn.
 *   6. `turnId` is the record `id`.
 */

export const SUPPORTED_VERSION = 2;

function parseLines(text) {
  const records = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object") records.push(record);
    } catch { /* a torn or foreign line */ }
  }
  return records;
}

function isMessage(record) {
  return record.type === "message" && typeof record.id === "string"
    && record.message && typeof record.message === "object";
}

export function isConversationRecord(record) {
  if (!isMessage(record)) return false;
  const { role, visibility, hookEventName } = record.message;
  return (role === "user" || role === "assistant") && !visibility && !hookEventName;
}

// Droid writes its own notices ("Exec ended early: …") as assistant records
// without the `modelId` every model reply carries.
function isHostNotice(record) {
  return record.message.role === "assistant" && !record.message.modelId;
}

function recordText(record) {
  const content = record.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string" && block.text)
    .map((block) => block.text)
    .join("\n");
}

/**
 * @returns {{ ok: true, sessionId: string, version: number, turns: Array<{turnId, role, content}> }
 *         | { ok: false, reason: "unknown_format", version?: unknown }}
 */
export function decodeDroidTranscript(text) {
  const records = parseLines(text);
  const header = records.find((record) => record.type === "session_start");
  if (!header || header.version !== SUPPORTED_VERSION) {
    return { ok: false, reason: "unknown_format", version: header?.version };
  }

  const byId = new Map();
  let last = null;
  for (const record of records) {
    if (!isMessage(record)) continue;
    byId.set(record.id, record);
    if (isConversationRecord(record)) last = record;
  }

  const chain = [];
  const seen = new Set();
  for (let cur = last; cur && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
    seen.add(cur.id);
    chain.push(cur);
  }
  chain.reverse();

  let start = 0;
  if (header.forkedAtMessageId) {
    const at = chain.findIndex((record) => record.id === header.forkedAtMessageId);
    if (at >= 0) start = at + 1;
  }

  const turns = [];
  for (const record of chain.slice(start)) {
    if (!isConversationRecord(record) || isHostNotice(record)) continue;
    const content = recordText(record);
    if (!content.trim()) continue;
    turns.push({ turnId: record.id, role: record.message.role, content });
  }
  return { ok: true, sessionId: String(header.id || ""), version: header.version, turns };
}
