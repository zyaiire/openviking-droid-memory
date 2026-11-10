# OpenViking Memory Plugin for Factory Droid

[中文](README_CN.md)

Long-term memory for local [Factory Droid](https://factory.ai/) (CLI, interactive and `droid exec`), backed by [OpenViking](https://github.com/volcengine/OpenViking). It is a community plugin built on upstream `examples/claude-code-memory-plugin`: the shared memory runtime is vendored unmodified, and only the Droid-specific hook entries, transcript decoder and MCP launcher live here.

```sh
droid plugin marketplace add https://github.com/zyaiire/openviking-droid-memory
droid plugin install openviking-memory@openviking-droid-memory
```

Requirements: an OpenViking server configured in `~/.openviking/ovcli.conf` (the file every OpenViking integration reads), and Node 18+ on `PATH`. To install from a checkout, pass its path to `marketplace add`; add `--scope project` to `install` to enable the plugin for one project only.

Verified against Droid CLI 0.232.0.

## What the hooks do

- **Session start** — injects the user profile and preferences, and replays anything an offline session queued. Droid also fires this for `-s`, `--fork` and `/compress`.
- **Prompt submit** — searches OpenViking for memories relevant to the prompt and injects them. Droid does not fire this hook under `droid exec`, so an `exec` run gets the profile but no per-prompt recall.
- **Stop** — reads the new user prompts and assistant replies from the session file Droid names in `transcript_path` and sends them to OpenViking. Commits once the session's pending tokens reach `commitTokenThreshold`.
- **PreCompact and SessionEnd** — capture anything not sent so far, then commit, so memories get extracted. `droid exec`, `/exit` and Ctrl-C all fire `SessionEnd`.

The plugin also provides the `openviking` MCP server (search, read, remember, …) and four skills: `openviking-memory`, `openviking-skills`, `ov-experience-memory`, `openviking-rule-search`.

Every hook fails open: if OpenViking is down or anything goes wrong, Droid carries on with no output from the plugin. Writes that fail while the server is unreachable are queued and replayed.

## Configuration

- Settings for this client go under `plugin.droid` in `ovcli.conf`, for example `{"plugin": {"droid": {"autoCapture": false}}}`. Every `OPENVIKING_*` variable the upstream plugin reads works too (`OPENVIKING_AUTO_RECALL`, `OPENVIKING_AUTO_CAPTURE`, `OPENVIKING_COMMIT_TOKEN_THRESHOLD`, …).
- `OPENVIKING_MEMORY_ENABLED=0` turns the plugin off; without it the plugin is on whenever `ovcli.conf` or `ov.conf` exists.
- OpenViking sessions are named `dr-<droid session id>`. A resumed session keeps its OpenViking session. A fork is a new Droid session and gets its own, capturing only the turns after the fork point.
- Recall compression is off by default. Upstream's local compressor drives the `claude` CLI and is not shipped.

## Layout

`plugin/` is the installable plugin; the repository root is the marketplace that lists it.

- `plugin/hooks/hooks.json` registers five events, one entry script each under `plugin/scripts/`: `session-start.mjs`, `auto-recall.mjs`, `auto-capture.mjs`, `pre-compact.mjs`, `session-end.mjs`.
- `plugin/scripts/droid-transcript.mjs` decodes Droid's session JSONL into turns; `plugin/scripts/lib/` holds the capture pass the three capture hooks share.
- `plugin/scripts/shared/`, `plugin/servers/mcp-proxy.mjs` and `plugin/skills/` are unmodified upstream files, pinned by commit and hash in [PIN.md](plugin/scripts/PIN.md).
- `plugin/mcp.json` starts the MCP proxy through a short inline launcher, because Droid does not substitute the plugin root in MCP config.

## Host notes

- The session file is the authoritative transcript; hook stdin is only the trigger. Each record's own `id` is the OpenViking `turn_id`, so a repeated or resumed capture never sends a turn twice.
- Capture follows the main conversation chain: tool calls, thinking, hook records, injected context and Droid's own notices are left out; turns before a `/compress` stay reachable.
- Hooks print nothing unless they inject context, because Droid reads any stdout of a prompt hook as context.
- Under `droid exec`, calling an MCP tool needs `--auto high`.
- Subagent (Task tool) sessions, Factory cloud sessions, missions and the desktop app are outside this plugin.
- Rewind and message edit were not run against Droid 0.232.0. Turns already sent from an abandoned branch stay in OpenViking.

[DESIGN.md](DESIGN.md) records the verified Droid extension surface and the decisions that follow from it.

## Diagnostics

```sh
droid mcp list                                        # expect: openviking  stdio  connected
OPENVIKING_DEBUG=1 droid exec "Reply with one word"   # then read the hook log
tail ~/.openviking/logs/droid-hooks.log
```

The log is JSON Lines, one entry per hook stage (`inject`, `push_turns`, `commit`, …). Upstream's doctor does not know the `droid` client and is not shipped.

## Tests

```sh
npm test
```

Covers the decoder against transcripts recorded from Droid, the capture cursor, every hook against a local stand-in for the OpenViking server (including a server outage and its replay), and the packaging and vendored-file hashes.

## License

[Apache-2.0](LICENSE). The vendored OpenViking runtime is Apache-2.0 from upstream `examples/`.
