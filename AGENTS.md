# Working in this repo

Community OpenViking memory plugin for local Factory Droid (CLI, interactive and `droid exec`). Verified host contract and decisions: [DESIGN.md](DESIGN.md).

## Layout

- The repo root is a Droid marketplace (`.factory-plugin/marketplace.json`); `plugin/` is the installable plugin `openviking-memory`. Only runtime files go under `plugin/`.
- `plugin/scripts/shared/`, `plugin/servers/mcp-proxy.mjs` and `plugin/skills/` are vendored from OpenViking's `examples/claude-code-memory-plugin`. Never edit them; bump the pin as described in [plugin/scripts/PIN.md](plugin/scripts/PIN.md).
- Droid-specific code is everything else under `plugin/scripts/`: the hook entries, `config.mjs`, `debug-log.mjs`, `droid-transcript.mjs` and `lib/`.
- `plugin/mcp.json` holds an inline launcher, because Droid does not substitute the plugin root into MCP config. Keep `${` out of that file.

A local-path marketplace install copies the working tree into Droid's plugin cache, so after editing run `droid plugin uninstall` and `install` again.

Tests live in `tests/` (`npm test`, Node 18+). `tests/fixtures/` holds anonymized transcripts and hook stdin recorded from Droid 0.232.0, plus the expected decoded turns.

## Rules

- Hooks fail open: any error exits 0, never blocking Droid. A hook prints the context envelope only when it injects, and nothing otherwise.
- Capture reads only the JSONL named by `transcript_path`; stdin is a trigger.
- Never commit OpenViking credentials, `ovcli.conf`, `.env` files, or real Droid session content. Fixtures must be anonymized.
