# Vendored OpenViking runtime

Pinned to [`volcengine/OpenViking@d2ef5dfaa3952f550d7587a4ef465ae378d9d95b`](https://github.com/volcengine/OpenViking/tree/d2ef5dfaa3952f550d7587a4ef465ae378d9d95b) (2026-11-09, upstream version 0.5.31, `claude-code-memory-plugin` 0.7.22).

Every file listed below is an unmodified copy from upstream `examples/`, licensed Apache-2.0 (`LICENSE`, copied from upstream `examples/LICENSE`). Do not edit these files. To change one, bump the pin: re-copy every file from the new commit, update the commit and hashes here, and re-run the tests.

## Files

Paths are relative to `plugin/`. The layout matches upstream `examples/claude-code-memory-plugin/`, so the upstream relative imports (`servers/mcp-proxy.mjs` → `../scripts/config.mjs`, `../scripts/shared/*`) resolve unchanged.

| Here | Upstream |
| --- | --- |
| `scripts/shared/*.mjs` | `examples/claude-code-memory-plugin/scripts/shared/*.mjs` (all 25 files) |
| `servers/mcp-proxy.mjs` | `examples/claude-code-memory-plugin/servers/mcp-proxy.mjs` |
| `skills/*/SKILL.md` | `examples/claude-code-memory-plugin/skills/*/SKILL.md`, except `ov-memory-doctor` |
| `LICENSE` | `examples/LICENSE` |

## SHA-256 (first 16 hex digits)

Check with `shasum -a 256 <file>` from `plugin/`.

| File | SHA-256 |
| --- | --- |
| `LICENSE` | `081a54b68d890cdb` |
| `scripts/shared/agent-hook-runtime.mjs` | `33e8840f53064185` |
| `scripts/shared/async-writer.mjs` | `6e0f5aa74a08d5a6` |
| `scripts/shared/batch-send.mjs` | `3e20e21f1418ab06` |
| `scripts/shared/capture-utils.mjs` | `7829a6db00e07e3d` |
| `scripts/shared/config-schema.mjs` | `b4ba5187cd0b2db4` |
| `scripts/shared/credentials.mjs` | `95c68b052bf6582d` |
| `scripts/shared/debug-log.mjs` | `ab5231b78ed7d517` |
| `scripts/shared/doctor-core.mjs` | `206bd306f40e972d` |
| `scripts/shared/input-filters.mjs` | `4ce31b25f2f173cb` |
| `scripts/shared/mcp-proxy-config.mjs` | `2a7ddfd977baba09` |
| `scripts/shared/mcp-proxy-core.mjs` | `90210d52c1077628` |
| `scripts/shared/ov-http.mjs` | `fd679ef97650e1a7` |
| `scripts/shared/pending-queue.mjs` | `596d85d70621ba66` |
| `scripts/shared/plugin-config.mjs` | `8093284c2c05f865` |
| `scripts/shared/profile-inject.mjs` | `8daeed176c617eda` |
| `scripts/shared/recall-compress-core.mjs` | `9e54f8df2256f6ff` |
| `scripts/shared/recall-core.mjs` | `768e16aebf9e7c1a` |
| `scripts/shared/retryable.mjs` | `7f12638ed0adfd0f` |
| `scripts/shared/session-model.mjs` | `c8886d817313618b` |
| `scripts/shared/setup-wizard.mjs` | `68d77456f6a90d1f` |
| `scripts/shared/uri-guard.mjs` | `7e9f3dc72ccec0dc` |
| `scripts/shared/workspace-config.mjs` | `0bbf9a3e597aea3f` |
| `scripts/shared/workspace-identity.mjs` | `cbee6219e34d825e` |
| `scripts/shared/workspace-peer.mjs` | `850229a2b1e0f919` |
| `scripts/shared/workspace-registry.mjs` | `c24df707628719e5` |
| `servers/mcp-proxy.mjs` | `70c9c9e8e2c5c39e` |
| `skills/openviking-memory/SKILL.md` | `7acc32358ba98c8b` |
| `skills/openviking-rule-search/SKILL.md` | `252cc2e0e36235ce` |
| `skills/openviking-skills/SKILL.md` | `83d4d71573b9a6fa` |
| `skills/ov-experience-memory/SKILL.md` | `9490d86db2fcfa57` |

## Ported, not vendored

These are this project's own code, written from the upstream Claude Code entry of the same name: `scripts/config.mjs`, `debug-log.mjs`, `session-start.mjs`, `auto-recall.mjs`, `auto-capture.mjs`, `pre-compact.mjs`, `session-end.mjs`, and `scripts/lib/state.mjs`, `ov-session.mjs`, `workspace-peer.mjs`. `droid-transcript.mjs` and `lib/capture.mjs` are new.

## Not vendored

- `scripts/ov-memory-doctor.mjs` and the `ov-memory-doctor` skill: the doctor's client table is hard-coded and has no `droid` entry.
- `scripts/lib/host-compressor.mjs`: it compresses recall through the `claude` CLI. The `droid` harness defaults `recallCompress` to `off`; `server` still works.
- Statusline, setup wizard, `uri-guard` and `skill-experience` hooks, subagent hooks.

## Known upstream gaps for `droid`

- `HARNESS_KEYS` in `config-schema.mjs` has no `droid` entry. Runtime config is unaffected (`plugin.droid` in `ovcli.conf` is still read); only the doctor's unknown-key check would flag it.
