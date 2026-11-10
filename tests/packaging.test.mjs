import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const json = (path) => JSON.parse(readFileSync(repo(path), "utf8"));

test("the marketplace lists the plugin at ./plugin with matching name and version", () => {
  const market = json(".factory-plugin/marketplace.json");
  const manifest = json("plugin/.factory-plugin/plugin.json");
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].source, "./plugin");
  assert.equal(market.plugins[0].name, manifest.name);
  assert.equal(market.plugins[0].version, manifest.version);
  assert.equal(manifest.name, "openviking-memory");
});

test("every hook command names a script that exists", () => {
  const { hooks } = json("plugin/hooks/hooks.json");
  assert.deepEqual(Object.keys(hooks).sort(), ["PreCompact", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"]);
  for (const groups of Object.values(hooks)) {
    for (const { command } of groups.flatMap((group) => group.hooks)) {
      const match = command.match(/^node "\$\{DROID_PLUGIN_ROOT\}\/(scripts\/[\w-]+\.mjs)"$/);
      assert.ok(match, command);
      assert.ok(existsSync(repo(`plugin/${match[1]}`)), match[1]);
    }
  }
});

test("mcp.json carries no ${…}: Droid neither substitutes it nor tolerates unset references", () => {
  const raw = readFileSync(repo("plugin/mcp.json"), "utf8");
  assert.equal(raw.includes("${"), false);
  const server = JSON.parse(raw).mcpServers.openviking;
  assert.equal(server.command, "node");
  assert.deepEqual(server.args.slice(0, 2), ["--input-type=module", "-e"]);
  assert.match(server.args[2], /openviking-memory@/);
  assert.match(server.args[2], /servers", "mcp-proxy\.mjs"/);
});

test("vendored files match the hashes in PIN.md", () => {
  const pin = readFileSync(repo("plugin/scripts/PIN.md"), "utf8");
  const rows = [...pin.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{16})` \|$/gm)];
  assert.ok(rows.length >= 30);
  for (const [, file, hash] of rows) {
    const actual = createHash("sha256").update(readFileSync(repo(`plugin/${file}`))).digest("hex").slice(0, 16);
    assert.equal(actual, hash, file);
  }
});
