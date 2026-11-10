# Droid × OpenViking memory plugin (MVP)

## Problem overview

A developer who uses [OpenViking](https://github.com/volcengine/OpenViking) with Cursor, Claude Code, Codex, Kimi, ZCode or Devin gets automatic memory: profile on session start, recall on each prompt, durable capture when a turn ends, plus MCP tools. The same person on **local Factory Droid** (CLI) gets none of that. Droid has plugins, Claude-Code-style lifecycle hooks and MCP, but there is no OpenViking integration for it.

The upstream `claude-code-memory-plugin` is close but does not run as-is: its client id is `claude-code`, its transcript parser reads Claude Code JSONL records (Droid's records have a different shape), it ships Claude-only parts (statusline mods, `/ov` command), and Droid does not substitute the plugin root inside a plugin's MCP config.

## Solution overview

Ship a **community Droid plugin** in this repo, installed through a Droid marketplace, built on the upstream `claude-code-memory-plugin`: its `scripts/shared/` runtime is vendored verbatim at a pinned commit, and the hook entry scripts, config and transcript decoder are rewritten for Droid with the upstream ones as the model. Host contract lives in [[DESIGN.md]], measured on a real local Droid.

```mermaid diff [What the user gets on local Droid]
 flowchart LR
-    U[Developer] -->|chat| D[Droid CLI]
-    D --> Void[No OpenViking memory]
+    U[Developer] -->|chat| D[Droid CLI]
+    D -->|hooks + MCP| P[openviking-droid-memory plugin]
+    P -->|recall / capture / tools| OV[OpenViking server]
```

## Goals

- Installable Droid plugin with the same class of automatic memory as the community Devin / ZCode / Kimi hosts.
- Fail-open hooks: OpenViking down or slow never breaks or blocks Droid.
- Pin the Droid version and record the measured host contract in `DESIGN.md` before claiming capture.
- Vendor `claude-code-memory-plugin/scripts/shared` at a known commit; never edit it.

## Non-goals (v1)

- Droid cloud / Factory web sessions, missions, and the desktop app (not sampled).
- Treating Stop stdin as the transcript.
- Statusline, `/ov` command, setup wizard, doctor.
- Subagent capture (Task tool not sampled), skill-experience and URI-guard hooks.
- Waiting on an upstream reply before coding (issue first, then implement).

## Locked decisions (2026-11-09)

| Topic | Decision |
| --- | --- |
| Base | Upstream `claude-code-memory-plugin`; vendor only `scripts/shared/*`, rewrite entry scripts for Droid |
| Packaging | Native `.factory-plugin/plugin.json` + `hooks/hooks.json` + `mcp.json` + skills, under `plugin/`; repo-root `.factory-plugin/marketplace.json` |
| Capability bar | SessionStart profile · UserPromptSubmit recall · Stop capture · commit on PreCompact / SessionEnd · MCP + skills |
| Runtime | Local Droid CLI (interactive and `droid exec`) |
| Capture authority | The session JSONL named by `transcript_path`; stdin is trigger + metadata |
| Turn identity | The record's own `id`; never positions |
| Host contract doc | [[DESIGN.md]], measured on Droid 0.232.0 |
| Upstream cadence | Open an OV issue, then code; upstream PR after the MVP works |

---

### Phase 1: Host contract and lab measurements

Pin a Droid version. Run lab sessions (exec, interactive, resume, fork, compaction, both exits) with hooks that dump stdin and env, plus a probe plugin installed through a local marketplace. Record the measured contract in [[DESIGN.md]] and keep anonymized fixtures.

### Phase 2: Plugin scaffold and vendored shared runtime

Add the marketplace and plugin manifests, `hooks/hooks.json`, `mcp.json`, skills, and the pinned copy of `scripts/shared` with `PIN.md`. Document Node version and "do not edit vendor; bump the pin" in a thin public `AGENTS.md`.

### Phase 3: SessionStart profile and UserPromptSubmit recall

Droid versions of `session-start.mjs` and `auto-recall.mjs` on top of the shared profile and recall cores, client id `droid`, OV session prefix `dr-`, workspace from the payload's `cwd`.

### Phase 4: OpenViking MCP proxy and memory skills

The plugin's `openviking` MCP server starts the vendored proxy through a launcher that finds the plugin's install path (Droid does not substitute the plugin root in MCP config). Skills are the upstream memory skill pack.

### Phase 5: Stop capture from the session JSONL

On `Stop`, `PreCompact` and `SessionEnd`, decode the session JSONL into user / assistant turns (main chain, fork-aware), send the unseen ones, and commit on `PreCompact` / `SessionEnd` or when pending tokens cross the threshold. Ship only after fixtures round-trip.

```callstack
 result = capture(event, hookInput)
 ├── records = readJsonl(transcript_path)
 ├── turns = decodeDroidTranscript(records)
 ├── plan = unseen(turns, state)
 ├── addAgentMessages(plan)
 └── if event in (pre-compact, session-end) or pending >= threshold: commit
```

### Phase 6: OpenViking feature issue and release

Open a feature issue on `volcengine/OpenViking` describing the community adapter and the small upstream changes that would let `claude-code-memory-plugin` serve Droid directly (configurable client id and transcript decoder, a `droid` harness key). Release the public repo.

## References

- [[DESIGN.md]] — measured Droid host contract
- [[README.md]] — install and limits
- Sister project: `zyaiire/openviking-devin-memory` (same phase plan, Devin host)
- Upstream: `volcengine/OpenViking` `examples/claude-code-memory-plugin`, tracking issue for Devin [#7267](https://github.com/volcengine/OpenViking/issues/7267)
