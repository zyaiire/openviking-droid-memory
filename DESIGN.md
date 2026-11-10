# Droid host contract

Status: **measured on local Droid CLI 0.232.0 (2026-11-09)**. Hook payloads, transcript records, resume, fork, compaction, exits, plugin install, hook-root substitution and MCP launch were sampled in a lab directory with stdin-dumping hooks and a probe plugin installed through a local marketplace. Open items are listed at the end of the sampling matrix.

| Item | Value |
| --- | --- |
| Droid CLI | `0.232.0` (`~/.local/bin/droid`) |
| Session record format | `session_start.version = 2` |
| Node target | 18+ (no native modules; the transcript is plain JSONL) |

Droid ships often, so the **`session_start.version` field is the test baseline**, not the CLI version.

## Product contract (locked)

- Install as a native Droid plugin (`.factory-plugin/plugin.json`, `hooks/hooks.json`, `mcp.json`, `skills/`) from a marketplace: `droid plugin marketplace add <repo>` then `droid plugin install openviking-memory@<marketplace>`.
- Capability bar matches the community Devin / ZCode / Kimi hosts: SessionStart profile · UserPromptSubmit recall · Stop capture · commit on PreCompact and SessionEnd · MCP tools and memory skills.
- Runtime: local Droid CLI, interactive and `droid exec`.
- Shared runtime: upstream `claude-code-memory-plugin/scripts/shared/` vendored verbatim at a pinned commit (see Vendor layout). This plugin owns only Droid's entry scripts, config, transcript decoding and the MCP launcher.
- Capture authority: the session JSONL named by `transcript_path`. Stdin is trigger + metadata only.
- Delivery shape toward OpenViking: decode records into turns `{ role, content, turn_id }` and send them with `addAgentMessages`, commit with `commitAgentSession`. Raw JSONL records are never uploaded.

## Hooks (measured)

- Events Droid knows: `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `Notification`. There is no `PostCompact` and no `SubagentStart`.
- Every payload carries `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`. Per event:
  - `SessionStart`: `source` (`startup`, or `resume` for `-s`, `--fork` and after `/compress`), `CLAUDE_ENV_FILE`; `message_id` on resume.
  - `UserPromptSubmit`: `prompt`, `message_id` (equals the `id` of the user record written next), `has_images`. **Does not fire under `droid exec`** (the prompt comes from argv), so `exec` gets the profile but no recall.
  - `Stop`: `message_id` (the final assistant record, already written), `stop_hook_active`, `tool_execution_count`, `elapsed_time`.
  - `PreCompact`: `trigger` (`manual` for `/compress`), `custom_instructions`, `message_count`, `estimated_tokens`, `message_id`. Fires before the summary is written.
  - `SessionEnd`: `reason`, `message_id` (last message), `session_duration_ms`, `message_count`.
- Hook processes run with cwd = project dir and `FACTORY_PROJECT_DIR`, `DROID_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` set to it. `DROID_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` in the hook **environment** hold the sentinel `/PLUGIN_ROOT_NOT_EXPANDED_ERROR`; the real root is substituted **textually** into a plugin hook's `command` string (`${DROID_PLUGIN_ROOT}`, `$DROID_PLUGIN_ROOT` and the `CLAUDE_` spellings).
- Output: `{ "hookSpecificOutput": { "hookEventName", "additionalContext" } }` for `SessionStart` and `UserPromptSubmit`. For `UserPromptSubmit` Droid keeps only the **first** non-empty context across all hooks, and plain non-JSON stdout (including a bare `{}`) also counts as context. In the lab, plugin hooks ran after runtime-settings hooks and before user-settings hooks.
- Timeout is in seconds; on timeout Droid sends SIGTERM to the hook process (spawned detached, so a grandchild survives). Exit code 2 blocks (`UserPromptSubmit` and `PreCompact` also block on 3); everything else is logged. **All hooks exit 0** — fail-open.
- Injected context is not written as a transcript message; it only appears inside the hook record's `hookResults[].stdout`.

## Session transcript (measured)

```text
~/.factory/sessions/<cwd with "/" replaced by "-">/<session_id>.jsonl   (+ <session_id>.settings.json)
```

`transcript_path` in every payload is that file. Rows already exist when `Stop` fires (the final assistant record's `id` equals Stop's `message_id`).

Record types:

- `session_start` (first line): `id` (= session id), `version`, `cwd`, `title`; a fork adds `parent` (source session id) and `forkedAtMessageId`.
- `message`: `id`, `parentId`, `timestamp`, `seq`, `message: { role, content: [blocks], visibility?, hookEventName?, ... }`.
  - Typed user prompt: `role: "user"`, no `visibility`, no `hookEventName`, `text` blocks.
  - Assistant reply: `role: "assistant"`, blocks `thinking`, `tool_use`, `text`.
  - Tool result: `role: "user"`, `tool_result` blocks.
  - Injected context: `role: "user"`, `visibility: "llm_only"`, `id` prefixed `context-` (system-reminder blocks before the first prompt; later turns may have none).
  - Hook record: `role: "user"`, `visibility: "user_only"`, `hookEventName` set, `content: []`.
  - Error notices: `role: "user"` with `visibility: "user_only"` or `"both"` (`BYOK Error…`, `Error: Your custom model…`).
- `agent_turn_outcome`: `turnId` (the user record id), `reason`, `resultKind`.
- `compaction_state`: `summaryText`, `summaryKind`, `anchorMessage`, `removedCount`, `systemInfo…`.

**Compaction** (`/compress`): `PreCompact` fires, then a `compaction_state` record is appended, then `SessionStart` fires with `source: "resume"`. No record is rewritten or deleted, and the next user record's `parentId` still points at the last assistant reply; later records carry `compactionSummaryId`.

**Resume** (`droid exec -s <id>`, `droid --resume`): appends to the same file, same session id.

**Fork** (`--fork <id>`): a new session file whose `session_start` names `parent` and `forkedAtMessageId`; every record up to the fork point is copied with its **original `id`**, then the new turns follow.

## Turn decoding (`plugin/scripts/droid-transcript.mjs`)

1. Parse each line as JSON; skip unparsable lines. The header is the first `session_start` record.
2. Index every `message` record by `id`. Conversation records are `role` `user` or `assistant` with **no `visibility`** and **no `hookEventName`**.
3. Walk the main chain: start at the last conversation record in file order and follow `parentId` to the root through any message record (context records sit on the chain). Compaction keeps parent links, so pre-compaction turns stay reachable without the `PreCompact` hook. Abandoned branches are not on the walk.
4. Fork: if the header has `forkedAtMessageId`, drop the chain up to and including that record — those turns belong to the parent session and were captured there.
5. A user turn is the joined `text` blocks (a record that only carries `tool_result` is not a turn). An assistant turn is the joined `text` blocks; `thinking` and `tool_use` are dropped, and a reply with no text is not a turn. One record is one turn. An assistant record **without `modelId`** is a notice Droid wrote itself (`Exec ended early: insufficient permission…`) and is not a turn; every model reply sampled carries `modelId`.
6. `turn_id` is the record `id`. Text is sanitized with the shared `sanitizeCapturedText` (strips `<openviking-context>`, `<system-reminder>` and the like) and filtered by `shouldCaptureText`.

**Compatibility gate.** No `session_start` record, or a `version` other than `2`, skips capture and logs `capture_unknown_format`. A missing or unreadable file logs `capture_missing` / `capture_unreadable` and sends nothing; a commit still runs on `PreCompact` / `SessionEnd` for turns sent earlier.

**Cursor.** Per-session state (`~/.openviking/hook-state/droid/<session>.json`, under the shared session lock) keeps `lastTurnId` and the last 1000 acknowledged `turn_id:role` keys. A capture sends only turns after the last occurrence of `lastTurnId`; if that id is not on the chain (rewind / edit), the whole chain is rescanned and the acknowledged set suppresses duplicates. Already-sent turns from an abandoned branch stay in OpenViking.

**Commit policy.** Every measured exit fires `SessionEnd`: `droid exec` (`reason: "other"`), `/exit` (`"other"`), Ctrl-C (`"other"`). So the Kimi policy applies, plus the upstream token threshold: `Stop` sends and commits only when the session's pending tokens reach `commitTokenThreshold`; `PreCompact` and `SessionEnd` always run a capture pass first and then commit. Because `SessionEnd` follows `Stop` within ~100 ms under `exec`, every capture pass runs under the shared per-session lock, so the commit cannot overtake the last turn.

## Plugin packaging (measured)

- `droid plugin marketplace add <path-or-repo>`; a local path works and the marketplace takes the **directory name** (not the manifest `name`). The repo root carries `.factory-plugin/marketplace.json` listing `./plugin`.
- `droid plugin install <plugin>@<marketplace> [--scope user|project]` copies a native (`.factory-plugin`) plugin verbatim to `~/.factory/plugins/cache/<marketplace>-<hash>/<plugin>-<hash>/<version>/` and writes `~/.factory/plugins/installed_plugins/<plugin>-<marketplace>-<scope>-<hash>.json` (`installPath`, `scope`, `lastUpdated`). A `.claude-plugin` plugin is translated on copy (`.mcp.json` → `mcp.json`, `agents/` → `droids/`).
- Hooks: `hooks/hooks.json` with the `{ "hooks": { … } }` wrapper. Substitution applies to hook commands, skills and droids.
- **MCP config gets no root substitution** (0.232.0): `${DROID_PLUGIN_ROOT}` in `args` reaches the process literally; `${VAR}` in `env` is treated as a credential reference and the server fails to start when the variable is unset; the MCP process gets no plugin variables and its cwd is the project dir. So `mcp.json` starts a small inline `node` launcher that reads the installed-plugin records under `(FACTORY_HOME_OVERRIDE ?? HOME)/.factory/plugins/installed_plugins/`, picks the newest `openviking-memory@*` install whose `servers/mcp-proxy.mjs` exists, and imports it.
- A local-path marketplace install copies the plugin's **working tree** (uncommitted edits included) but names the version after the repo's git `HEAD` (`f9ec8289b455`), so after editing, `droid plugin uninstall` + `install` to refresh the cache.
- Plugin MCP tools are exposed as `openviking___<tool>` (e.g. `openviking___search`). Under `droid exec`, calling one needs `--auto high`; lower levels end the run with `Exec ended early: insufficient permission…`.
- Plugin skills are listed in the injected "Available skills" reminder (`openviking-memory`, …).
- A plugin-root `AGENTS.md` is **not** injected into sessions; contributor docs still stay at the repo root.
- Droid does not import Cursor's or Claude's MCP servers (`droid mcp list` shows only `~/.factory/mcp.json` and plugin servers), so there is no duplicate `openviking` server to reconcile.

## Vendor layout

```text
plugin/
  .factory-plugin/plugin.json
  hooks/hooks.json
  mcp.json                        inline launcher -> servers/mcp-proxy.mjs
  scripts/
    shared/                       verbatim upstream scripts/shared (do not edit)
    PIN.md                        upstream commit + hash of every verbatim file
    config.mjs  debug-log.mjs     ours: client id `droid`, log droid-hooks.log
    session-start.mjs             ours (from upstream session-start.mjs)
    auto-recall.mjs               ours (from upstream auto-recall.mjs)
    auto-capture.mjs  pre-compact.mjs  session-end.mjs   ours: thin entries over lib/capture.mjs
    droid-transcript.mjs          ours: JSONL decoder
    lib/                          ours (state, ov-session, workspace-peer, envelope, capture, capture-entry)
  servers/mcp-proxy.mjs           verbatim upstream
  skills/                         verbatim upstream skills
```

The shared runtime treats the client id as a free string, so `droid` needs no vendor patch: state under `~/.openviking/hook-state/droid/`, logs `~/.openviking/logs/droid-hooks.log`, OV sessions `dr-<droid session id>`, and `plugin.droid` in `ovcli.conf` is read. Only `HARNESS_KEYS` (the doctor's unknown-key check) does not list `droid`; the doctor is not vendored.

## Explicit non-goals (v1)

- Factory cloud / web sessions, missions, the desktop app.
- Treating Stop stdin as the transcript.
- Retracting abandoned-branch content from OpenViking.
- Statusline, `/ov` command, setup wizard, doctor.
- Subagent capture, skill-experience and URI-guard hooks (Droid tool names differ: `Execute`, `Create`, `FetchUrl`…).

## Phase 1 sampling matrix

- [x] Version baseline: Droid 0.232.0, `session_start.version = 2`.
- [x] `droid exec` with a tool call: SessionStart, PreToolUse/PostToolUse, Stop, SessionEnd fire; **UserPromptSubmit does not**. Rows exist when Stop fires.
- [x] Interactive TUI: UserPromptSubmit fires with `prompt` and `message_id`.
- [x] Decoding on real records: the walk plus rule 5 yields exactly the typed prompts and the assistant text replies (tool-call session, multi-turn session, compacted session, fork).
- [x] Resume (`-s`): same file, `SessionStart.source = "resume"`.
- [x] Fork (`--fork`): new file, `parent` + `forkedAtMessageId`, copied ids preserved.
- [x] Compaction (`/compress`): PreCompact (`trigger: manual`) → `compaction_state` → SessionStart `resume`; chain intact.
- [x] Exits: `exec`, `/exit`, Ctrl-C each fire SessionEnd (`reason: "other"`) → Kimi commit policy.
- [x] Plugin via local marketplace, project scope: hooks fire with the root substituted; `additionalContext` accepted for SessionStart and UserPromptSubmit; plugin-root `AGENTS.md` not injected.
- [x] Plugin MCP: no root substitution; `${VAR}` in `env` fails as an unset credential → launcher.
- [x] Other hook sources in this environment: user-level status-bar hooks (vibe-island prints `{}` on every event, which Droid would read as context if it ran first).
- [x] Anonymized fixtures: `tests/fixtures/hook-stdin.json`, `tests/fixtures/transcripts/*.jsonl` with expected turns (`tests/fixtures/expected-turns.json`).
- [x] Real plugin, project scope, against a live OpenViking: `droid mcp list` shows `openviking … connected`; `droid exec --auto high` called `openviking___search`; Stop sent 3 turns to `dr-<id>` and SessionEnd (~40 ms later, behind the lock) found nothing new and committed (`total_message_count: 3`, `commit_count: 1`). Interactive: the plugin's UserPromptSubmit context was the one used (the model answered from it without tools), `/compress` → PreCompact commit → SessionStart `resume` re-injected the profile, `/exit` → SessionEnd.
- [x] Host notices: `Exec ended early: …` is written as an assistant record with no `modelId`; decoding skips it.
- [ ] Still open: subagent (Task tool) sessions and `SubagentStop`; rewind / edit topology; Factory desktop app; whether the marketplace name for a GitHub source is the repo name.

## References

- [[README.md]], [[specs/droid-ov-memory-mvp.md]], [[AGENTS.md]]
- Upstream base: `volcengine/OpenViking` `examples/claude-code-memory-plugin` (see `plugin/scripts/PIN.md`)
- Sister host: `zyaiire/openviking-devin-memory` (`DESIGN.md` there for the Devin contract)
