import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { decodeDroidTranscript } from "../plugin/scripts/droid-transcript.mjs";
import {
  applyCaptureResult,
  buildCapturePlan,
  selectNewTurns,
} from "../plugin/scripts/lib/capture.mjs";

const turnsOf = (name) => decodeDroidTranscript(
  readFileSync(new URL(`./fixtures/transcripts/${name}.jsonl`, import.meta.url), "utf8"),
).turns;
const cfg = { captureAssistantTurns: true, captureMode: "semantic" };

function capture(turns, state, config = cfg, captured = Infinity) {
  const selected = selectNewTurns(turns, state);
  const plan = buildCapturePlan(selected.turns, state, config);
  const next = applyCaptureResult(state, selected.turns, plan, Math.min(captured, plan.toSend.length));
  return { selected, plan, next };
}

test("payloads carry role, sanitized content and turn_id", () => {
  const { plan } = capture(turnsOf("branch-and-errors"), {});
  assert.deepEqual(plan.toSend.map(({ payload }) => payload), [
    { role: "user", content: "List the files in the project directory.", turn_id: "u1" },
    { role: "assistant", content: "The directory has\nthree files.", turn_id: "a2" },
    { role: "user", content: "Actually, just count them.", turn_id: "u2" },
    { role: "assistant", content: "There are 3 files.", turn_id: "a3" },
  ]);
});

test("acks and too-short replies are acknowledged without being sent", () => {
  const { plan, next } = capture(turnsOf("interactive"), {});
  assert.deepEqual(plan.toSend.map(({ payload }) => payload.content), [
    "Remember the code word is PELICAN. Reply OK.",
    "What is 2+3? Reply with just the number.",
  ]);
  assert.equal(plan.skipped.length, 2);
  assert.equal(next.lastTurnId, turnsOf("interactive").at(-1).turnId);
});

test("a resumed session sends only the new turns", () => {
  const all = turnsOf("resume");
  const first = capture(all.slice(0, 2), {});
  assert.equal(first.next.lastTurnId, all[1].turnId);
  const second = capture(all, first.next);
  assert.deepEqual(second.selected.turns.map((turn) => turn.turnId), all.slice(2).map((turn) => turn.turnId));
  assert.deepEqual(second.plan.toSend.map(({ payload }) => payload.turn_id), all.slice(2).map((turn) => turn.turnId));
});

test("a second pass over the same transcript sends nothing", () => {
  const all = turnsOf("compaction");
  const { next } = capture(all, {});
  const again = capture(all, next);
  assert.equal(again.selected.turns.length, 0);
  assert.equal(again.plan.toSend.length, 0);
});

test("a lost cursor rescans the chain and the acknowledged set suppresses duplicates", () => {
  const all = turnsOf("compaction");
  const { next } = capture(all, {});
  const again = capture(all, { ...next, lastTurnId: "gone-after-rewind" });
  assert.equal(again.selected.rescanned, true);
  assert.equal(again.plan.toSend.length, 0);
});

test("a partial send keeps the cursor before the first unsent turn", () => {
  const all = turnsOf("branch-and-errors");
  const { next } = capture(all, {}, cfg, 2);
  assert.equal(next.lastTurnId, "a2");
  assert.equal(next.hasMessages, true);
  const retry = capture(all, next);
  assert.deepEqual(retry.plan.toSend.map(({ payload }) => payload.turn_id), ["u2", "a3"]);
});

test("nothing sent leaves hasMessages unset", () => {
  const { next } = capture(turnsOf("branch-and-errors"), {}, cfg, 0);
  assert.equal(next.hasMessages, false);
  assert.equal(next.lastTurnId, null);
});

test("captureAssistantTurns=false sends user turns only", () => {
  const { plan } = capture(turnsOf("resume"), {}, { ...cfg, captureAssistantTurns: false });
  assert.ok(plan.toSend.every(({ payload }) => payload.role === "user"));
  assert.ok(plan.skipped.some((key) => key.endsWith(":assistant")));
});

test("keyword mode sends a batch only when a user turn carries a trigger", () => {
  const keyword = { ...cfg, captureMode: "keyword" };
  assert.ok(capture(turnsOf("compaction"), {}, keyword).plan.toSend.length > 0);
  const miss = capture(turnsOf("fork"), {}, keyword);
  assert.equal(miss.plan.toSend.length, 0);
  assert.equal(miss.plan.keywordMiss, true);
});
