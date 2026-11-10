import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { decodeDroidTranscript } from "../plugin/scripts/droid-transcript.mjs";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const expected = JSON.parse(readFileSync(fixture("expected-turns.json"), "utf8"));
const transcript = (name) => readFileSync(fixture(`transcripts/${name}.jsonl`), "utf8");

for (const name of Object.keys(expected).filter((key) => key !== "_comment")) {
  test(`decodes ${name}.jsonl into the expected turns`, () => {
    const decoded = decodeDroidTranscript(transcript(name));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.version, 2);
    assert.deepEqual(
      decoded.turns.map(({ turnId, role, content }) => ({ turn_id: turnId, role, content })),
      expected[name],
    );
  });
}

test("a fork keeps only the turns after forkedAtMessageId", () => {
  const parent = decodeDroidTranscript(transcript("resume")).turns.map((turn) => turn.turnId);
  const fork = decodeDroidTranscript(transcript("fork")).turns.map((turn) => turn.turnId);
  assert.equal(fork.length, 2);
  assert.ok(fork.every((id) => !parent.includes(id)));
});

test("compaction keeps the pre-compaction turns on the chain", () => {
  const turns = decodeDroidTranscript(transcript("compaction")).turns;
  assert.ok(turns.some((turn) => turn.content.includes("code word is PELICAN")));
  assert.equal(turns.at(-1).content, "PELICAN");
});

test("an unknown session format is refused", () => {
  const body = transcript("interactive").split("\n").slice(1).join("\n");
  assert.deepEqual(decodeDroidTranscript(body), { ok: false, reason: "unknown_format", version: undefined });
  const v3 = transcript("interactive").replace('"version": 2', '"version": 3').replace('"version":2', '"version":3');
  assert.equal(decodeDroidTranscript(v3).ok, false);
  assert.equal(decodeDroidTranscript(v3).version, 3);
});

test("torn and foreign lines are skipped", () => {
  const text = `${transcript("interactive")}{"type":"message","id":"torn\nnot json at all\n[1,2]\n`;
  assert.deepEqual(decodeDroidTranscript(text).turns, decodeDroidTranscript(transcript("interactive")).turns);
});

test("an empty or header-only transcript has no turns", () => {
  assert.equal(decodeDroidTranscript("").ok, false);
  const header = transcript("interactive").split("\n")[0];
  assert.deepEqual(decodeDroidTranscript(header).turns, []);
});
