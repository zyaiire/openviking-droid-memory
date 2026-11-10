import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../plugin/scripts/", import.meta.url));
const STDIN = JSON.parse(readFileSync(new URL("./fixtures/hook-stdin.json", import.meta.url), "utf8"));
const transcriptFixture = (name) => fileURLToPath(new URL(`./fixtures/transcripts/${name}.jsonl`, import.meta.url));

let server;
let baseUrl;
let requests = [];
let pendingTokens = 0;
let up = true;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!up) {
        res.writeHead(503).end();
        return;
      }
      const url = new URL(req.url, "http://x");
      requests.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null });
      const send = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", result }));
      };
      if (url.pathname === "/health") return send({ healthy: true });
      if (/\/messages\/batch$/.test(url.pathname)) return send({ added: body ? JSON.parse(body).messages.length : 0 });
      if (/\/commit$/.test(url.pathname)) return send({ status: "accepted", trace_id: "t-1" });
      if (/^\/api\/v1\/sessions\/[^/]+$/.test(url.pathname)) return send({ pending_tokens: pendingTokens });
      return send({});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

let home;
beforeEach(() => {
  requests = [];
  pendingTokens = 0;
  up = true;
  home = mkdtempSync(join(tmpdir(), "ov-droid-home-"));
});

function runHook(script, stdin, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(SCRIPTS, script)], {
      cwd: home,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        OPENVIKING_URL: baseUrl,
        OPENVIKING_MEMORY_ENABLED: "1",
        OPENVIKING_WRITE_PATH_ASYNC: "0",
        OPENVIKING_TIMEOUT_MS: "2000",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof stdin === "string" ? stdin : JSON.stringify(stdin));
  });
}

function payload(event, transcript, extra = {}) {
  const path = join(home, `${transcript}.jsonl`);
  if (!existsSync(path)) writeFileSync(path, readFileSync(transcriptFixture(transcript)));
  return { ...STDIN[event], session_id: `sess-${transcript}`, cwd: home, transcript_path: path, ...extra };
}

const batches = () => requests.filter((r) => r.path.endsWith("/messages/batch"));
const commits = () => requests.filter((r) => r.path.endsWith("/commit"));

test("Stop sends the decoded turns once, to dr-<session id>", async () => {
  const first = await runHook("auto-capture.mjs", payload("Stop", "resume"));
  assert.equal(first.code, 0);
  assert.equal(first.stdout, "");
  assert.equal(batches().length, 1);
  assert.equal(batches()[0].path, "/api/v1/sessions/dr-sess-resume/messages/batch");
  assert.deepEqual(batches()[0].body.messages.map((m) => [m.role, m.turn_id.slice(0, 8)]), [
    ["user", "210b1757"], ["assistant", "8463e07a"], ["user", "1de10387"], ["assistant", "b0f54335"],
  ]);
  assert.equal(commits().length, 0);

  await runHook("auto-capture.mjs", payload("Stop", "resume"));
  assert.equal(batches().length, 1, "a second Stop has nothing new");
});

test("Stop commits once pending tokens reach the threshold", async () => {
  pendingTokens = 50000;
  await runHook("auto-capture.mjs", payload("Stop", "interactive"));
  assert.equal(commits().length, 1);
  assert.deepEqual(commits()[0].body, { keep_recent_count: 0 });
});

test("SessionEnd captures what Stop missed, then commits", async () => {
  const res = await runHook("session-end.mjs", payload("SessionEnd", "compaction"));
  assert.equal(res.code, 0);
  assert.equal(batches().length, 1);
  assert.equal(batches()[0].body.messages.at(-1).content, "PELICAN");
  assert.equal(commits().length, 1);
  assert.equal(commits()[0].path, "/api/v1/sessions/dr-sess-compaction/commit");
});

test("PreCompact commits; a session that never captured anything is not committed", async () => {
  await runHook("pre-compact.mjs", payload("PreCompact", "fork"));
  assert.equal(commits().length, 1);
  requests = [];
  await runHook("session-end.mjs", payload("SessionEnd", "fork", { transcript_path: join(home, "missing.jsonl"), session_id: "sess-empty" }));
  assert.equal(commits().length, 0);
});

test("a server outage queues the turns instead of losing them", async () => {
  up = false;
  const res = await runHook("auto-capture.mjs", payload("Stop", "interactive"));
  assert.equal(res.code, 0);
  up = true;
  const replayed = await runHook("session-start.mjs", payload("SessionStart:startup", "interactive"), { OPENVIKING_NO_AUTO_INJECT: "1" });
  assert.equal(replayed.code, 0);
  const sent = requests.filter((r) => /\/messages(\/batch)?$/.test(r.path));
  assert.ok(sent.length > 0, "queued turns are replayed at the next SessionStart");
});

test("UserPromptSubmit stays silent when there is nothing to inject", async () => {
  const short = await runHook("auto-recall.mjs", { ...STDIN.UserPromptSubmit, cwd: home, prompt: "hi" });
  assert.equal(short.code, 0);
  assert.equal(short.stdout, "");
  const empty = await runHook("auto-recall.mjs", "");
  assert.equal(empty.code, 0);
  assert.equal(empty.stdout, "");
});

test("every hook fails open with garbage stdin and no server", async () => {
  for (const script of ["session-start.mjs", "auto-recall.mjs", "auto-capture.mjs", "pre-compact.mjs", "session-end.mjs"]) {
    const res = await runHook(script, "not json", { OPENVIKING_URL: "http://127.0.0.1:9" });
    assert.equal(res.code, 0, script);
    assert.equal(res.stdout, "", script);
  }
});

test("disabled plugin exits silently", async () => {
  for (const script of ["session-start.mjs", "auto-recall.mjs", "auto-capture.mjs"]) {
    const res = await runHook(script, payload("Stop", "interactive"), { OPENVIKING_MEMORY_ENABLED: "0" });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, "");
  }
  assert.equal(requests.length, 0);
});
