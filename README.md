# openviking-droid-memory

Community [OpenViking](https://github.com/volcengine/OpenViking) memory plugin for local [Factory Droid](https://factory.ai/) (CLI, interactive and `droid exec`).

It gives Droid the same automatic memory the OpenViking Claude Code, Cursor, Kimi Code, ZCode and Devin integrations have. It is built on upstream `examples/claude-code-memory-plugin`, whose shared runtime is vendored unchanged.

## What it does

| When | What happens |
| --- | --- |
| Session starts (also after `-s`, `--fork` and `/compress`) | Your OpenViking profile is injected as context. |
| You send a prompt (interactive only; Droid does not fire this hook under `droid exec`) | Memories relevant to the prompt are recalled and injected. |
| A turn ends (`Stop`) | New user prompts and assistant replies are read from the session file Droid names (`~/.factory/sessions/…/<id>.jsonl`) and sent to OpenViking. |
| Before `/compress`, and when the session ends | Anything not yet sent is captured, then the OpenViking session is committed so memories get extracted. |
| Any time | `openviking` MCP tools (search, read, remember, …) and four skills: `openviking-memory`, `openviking-skills`, `ov-experience-memory`, `openviking-rule-search`. |

Every hook fails open: if OpenViking is down or anything goes wrong, Droid carries on with no output from the plugin. Writes that fail while the server is down are queued and replayed later.

## Install

```sh
droid plugin marketplace add https://github.com/zyaiire/openviking-droid-memory
droid plugin install openviking-memory@openviking-droid-memory
# or from a checkout
droid plugin marketplace add ./openviking-droid-memory
droid plugin install openviking-memory@openviking-droid-memory --scope project
```

Requirements:

- An OpenViking server, configured in `~/.openviking/ovcli.conf` (the same file other OpenViking integrations use).
- Node 18+ on `PATH`.

Check it with `droid mcp list` (expect `openviking … connected`). With `OPENVIKING_DEBUG=1`, hooks log to `~/.openviking/logs/droid-hooks.log`.

## Configuration notes

- Settings for this client go under `plugin.droid` in `ovcli.conf`, e.g. `{"plugin": {"droid": {"autoCapture": false}}}`; every `OPENVIKING_*` variable the upstream plugin reads works too (`OPENVIKING_AUTO_CAPTURE=false`, `OPENVIKING_COMMIT_TOKEN_THRESHOLD`, …).
- OpenViking sessions are named `dr-<droid session id>`. A fork is a new Droid session and gets its own; it captures only the turns after the fork point.
- Under `droid exec`, calling an MCP tool needs `--auto high`.

## Limits

- Local Droid CLI only; Factory cloud sessions, missions and the desktop app are not covered.
- Subagent (Task tool) sessions are not captured.
- After a rewind or edit, turns already sent from the abandoned branch stay in OpenViking.
- A crash or kill that skips `SessionEnd` leaves the last turns sent but uncommitted until the session is resumed and ends normally.
- No local recall compression (upstream's runs through the `claude` CLI); `recallCompress: "server"` still works.
- No doctor command yet; the upstream doctor does not know the `droid` client.

## Development

- Host contract and measured Droid behavior: [DESIGN.md](DESIGN.md). Contributor rules: [AGENTS.md](AGENTS.md). Phase plan: [specs/droid-ov-memory-mvp.md](specs/droid-ov-memory-mvp.md).
- `npm test` runs the decoder, capture-plan, hook (against a fake OpenViking server) and packaging tests against anonymized fixtures.
- The OpenViking runtime under `plugin/scripts/shared/`, `plugin/servers/` and `plugin/skills/` is vendored verbatim; see [PIN.md](plugin/scripts/PIN.md).

## License

[Apache-2.0](LICENSE). The vendored OpenViking runtime is Apache-2.0 from upstream `examples/`.
