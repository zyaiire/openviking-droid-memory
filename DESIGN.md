# DESIGN: the Droid host

Verified against Droid CLI 0.232.0 (session record format `session_start.version = 2`) and Node.js 18+, with the plugin installed from this repository's marketplace and a live OpenViking server. Droid ships often, so the session format version is the compatibility baseline, not the CLI version.

The shared runtime is upstream `examples/claude-code-memory-plugin/scripts/shared`, vendored unmodified at a pinned commit ([PIN.md](plugin/scripts/PIN.md)). This plugin owns only what differs on Droid: the hook entries, the output envelope, transcript decoding, the commit policy and the MCP launcher.

## Verified Droid extension surface

| Aspect | Verified fact |
| --- | --- |
| Hook events | `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `Notification`. No `PostCompact`, no `SubagentStart`. |
| Common stdin | `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` |
| `SessionStart` stdin | `source` (`startup`; `resume` for `-s`, `--fork` and `/compress`), `CLAUDE_ENV_FILE`; `message_id` on resume |
| `UserPromptSubmit` stdin | `prompt`, `message_id` (the `id` of the user record written next), `has_images`. **Not fired under `droid exec`.** |
| `Stop` stdin | `message_id` (the final assistant record, already written), `stop_hook_active`, `tool_execution_count`, `elapsed_time` |
| `PreCompact` stdin | `trigger` (`manual` for `/compress`), `message_count`, `estimated_tokens`, `message_id` |
| `SessionEnd` stdin | `reason`, `session_duration_ms`, `message_count`. Fired by `droid exec`, `/exit` and Ctrl-C alike, with `reason: "other"`. |
| Hook environment | cwd is the project dir; `FACTORY_PROJECT_DIR`, `DROID_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` are set to it. `DROID_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` hold the sentinel `/PLUGIN_ROOT_NOT_EXPANDED_ERROR`. |
| Plugin root in hooks | Substituted textually into the hook `command` string: `${DROID_PLUGIN_ROOT}`, `$DROID_PLUGIN_ROOT` and the `CLAUDE_` spellings |
| Plugin root in MCP config | **Not substituted.** `${DROID_PLUGIN_ROOT}` in `args` reaches the process literally; `${VAR}` in `env` is a credential reference and the server fails to start when it is unset. The MCP process gets no plugin variables; its cwd is the project dir. |
| Context injection | `{ "hookSpecificOutput": { "hookEventName", "additionalContext" } }` on `SessionStart` and `UserPromptSubmit` |
| `UserPromptSubmit` stdout | Only the first non-empty context across all hooks is used, and any non-JSON or bare `{}` stdout counts as one. Plugin hooks run before user-settings hooks. |
| Timeouts and exit codes | `timeout` is in seconds; expiry sends SIGTERM to the hook, which is spawned detached. Exit 2 blocks (3 too, for `UserPromptSubmit` and `PreCompact`). |
| `/compress` | `SessionStart` (`source: "resume"`) fires, then `PreCompact`, then a `compaction_state` record is appended. Context injected at `SessionStart` is still available to the model afterwards. |
| Marketplace | `droid plugin marketplace add <path or GitHub URL>`; the marketplace is named after the directory or repository, not the manifest `name` |
| Install | `droid plugin install <plugin>@<marketplace> [--scope user\|project]` copies the plugin to `~/.factory/plugins/cache/<marketplace>-<hash>/<plugin>-<hash>/<version>/` and records it in `~/.factory/plugins/installed_plugins/*.json` (`pluginId`, `entry.installPath`, `entry.lastUpdated`). The version is the source's git `HEAD`. |
| Plugin MCP tools | Exposed as `openviking___<tool>`. Under `droid exec`, calling one needs `--auto high`. |
| Plugin skills | Listed in the session's "Available skills" reminder |
| Plugin-root `AGENTS.md` | Not injected into sessions |
| Other clients' MCP servers | Not imported; `droid mcp list` shows only `~/.factory/mcp.json` and plugin servers |

## Session transcript

`transcript_path` names `~/.factory/sessions/<cwd with "/" replaced by "-">/<session_id>.jsonl`. The rows of a turn are on disk when `Stop` fires.

| Record | Shape |
| --- | --- |
| `session_start` (first line) | `id` (the session id), `version`, `cwd`, `title`; a fork adds `parent` and `forkedAtMessageId` |
| `message` | `id`, `parentId`, `timestamp`, `message: { role, content: [blocks], visibility?, hookEventName?, modelId? }` |
| typed prompt | `role: "user"`, no `visibility`, no `hookEventName`, `text` blocks |
| model reply | `role: "assistant"`, `modelId`, blocks `thinking`, `tool_use`, `text` |
| tool result | `role: "user"`, `tool_result` blocks |
| injected host context | `role: "user"`, `visibility: "llm_only"`, `id` prefixed `context-` |
| hook record | `role: "user"`, `visibility: "user_only"`, `hookEventName`, empty `content`; hook stdout is kept under `hookResults` |
| error notice | `role: "user"`, `visibility: "user_only"` or `"both"` |
| Droid notice | `role: "assistant"` with no `modelId` (`Exec ended early: …`) |
| `agent_turn_outcome` | `turnId` (the user record id), `reason`, `resultKind` |
| `compaction_state` | `summaryText`, `anchorMessage`, `removedCount` |

- **Resume** (`droid exec -s <id>`, `droid --resume`) appends to the same file under the same session id.
- **Fork** (`--fork <id>`) writes a new file whose header names `parent` and `forkedAtMessageId`; every record up to the fork point is copied with its original `id`.
- **Compaction** rewrites nothing. The next user record's `parentId` still points at the last reply before it.

## Key design decisions

### 1. The session file is the capture source

Capture reads only the JSONL named by `transcript_path`. Hook stdin is the trigger and carries no conversation. Raw records are never uploaded: they are decoded into `{ role, content, turn_id }` and sent with `addAgentMessages`.

### 2. Turn decoding (`plugin/scripts/droid-transcript.mjs`)

1. Unparsable lines are skipped. The header is the first `session_start`; a missing header or a `version` other than `2` skips capture and logs `capture_unknown_format`.
2. Conversation records are `message` records with role `user` or `assistant` and neither `visibility` nor `hookEventName`.
3. The main chain runs from the last conversation record in file order up its `parentId` links. Compaction keeps the links, so earlier turns stay reachable. Records off that chain are not turns.
4. A fork drops the chain up to and including `forkedAtMessageId`: those turns belong to the parent session.
5. One record is one turn: its `text` blocks, joined. `thinking`, `tool_use`, `tool_result` and images are not turn text; a record without text and an assistant record without `modelId` are not turns.
6. `turn_id` is the record `id`. Text is cleaned with the shared `sanitizeCapturedText`, which strips `<openviking-context>`, `<system-reminder>` and similar blocks, then filtered by `shouldCaptureText`.

### 3. Cursor and deduplication

Per-session state (`~/.openviking/hook-state/droid/<session>.json`) holds `lastTurnId` and the last 1000 acknowledged `turn_id:role` keys. A pass sends the turns after `lastTurnId`. If that record is no longer on the chain, the whole chain is rescanned and the acknowledged set suppresses duplicates. A turn is acknowledged once it is sent or queued for replay; the cursor moves only through an unbroken acknowledged run.

### 4. Capture on three events, one lock

`Stop`, `PreCompact` and `SessionEnd` each run the same capture pass under the shared per-session lock, then decide on the commit:

- `Stop` commits when the OpenViking session's pending tokens reach `commitTokenThreshold`.
- `PreCompact` and `SessionEnd` always commit, unless the session never captured anything.

Under `droid exec`, `SessionEnd` follows `Stop` within about 100 ms, so the lock is what keeps the final commit behind the last turn. The final pass retries the lock rather than giving up.

### 5. Hooks are silent unless they inject

Droid reads any stdout of a `UserPromptSubmit` hook as context, so no hook writes `{ "decision": "approve" }` or `{}`. A hook prints the `hookSpecificOutput` envelope when it has context and nothing otherwise. Every hook exits 0 on any failure.

### 6. The profile goes out on every `SessionStart`

Droid reports `resume` for `-s`, `--fork` and `/compress` alike, so the hook cannot tell a fork (a new session with no profile yet) from the others and injects each time.

### 7. MCP through an inline launcher

Because the plugin root is not substituted in MCP config, `mcp.json` starts `node -e` with a short launcher. It reads the install records under `(FACTORY_HOME_OVERRIDE ?? HOME)/.factory/plugins/installed_plugins/`, picks the newest `openviking-memory@*` install whose `servers/mcp-proxy.mjs` exists, and imports it. `mcp.json` contains no `${…}`.

### 8. Client identity

Client id `droid`: settings under `plugin.droid` in `ovcli.conf`, state under `~/.openviking/hook-state/droid/`, log `~/.openviking/logs/droid-hooks.log`, OpenViking sessions `dr-<droid session id>`. The shared runtime treats the client id as a free string, so nothing vendored is patched. Upstream's `HARNESS_KEYS` has no `droid` entry, which only its doctor reads; the doctor is not shipped.

## Layout

```text
.factory-plugin/marketplace.json   marketplace listing ./plugin
plugin/
  .factory-plugin/plugin.json
  hooks/hooks.json
  mcp.json                         inline launcher -> servers/mcp-proxy.mjs
  scripts/
    session-start.mjs  auto-recall.mjs                 context hooks
    auto-capture.mjs  pre-compact.mjs  session-end.mjs  capture hooks
    droid-transcript.mjs           session JSONL decoder
    config.mjs  debug-log.mjs
    lib/                           capture pass, envelope, session and state helpers
    shared/                        upstream scripts/shared, unmodified
    PIN.md                         upstream commit and file hashes
  servers/mcp-proxy.mjs            upstream, unmodified
  skills/                          upstream, unmodified
tests/                             decoder, capture, hook and packaging tests; fixtures
```

## Not covered

- Subagent (Task tool) sessions and `SubagentStop`.
- Factory cloud sessions, missions and the desktop app.
- Upstream's statusline, setup wizard, doctor, `uri-guard` and `skill-experience` hooks. Droid's tool names differ (`Execute`, `Create`, `FetchUrl`).
- Rewind and message edit. The decoder follows `parentId` and is tested on a branched transcript, but neither command was run against Droid 0.232.0. Turns already sent from an abandoned branch stay in OpenViking.
