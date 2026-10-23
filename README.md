# openviking-droid-memory

Community OpenViking memory integration for [Factory Droid](https://factory.ai/).

Gives Droid automatic recall / capture (lifecycle hooks) plus OpenViking MCP tools — the same class of experience as the official Cursor / Codex memory plugins, maintained as a community project.

## Status

Scaffold only. Host contract, MVP scope, and upstream PR plan are still being discussed.

## Planned shape

- Public repo (this one): installable Factory plugin / marketplace entry, community release cadence
- Upstream: thin `hosts/droid` adapter PR into [`volcengine/OpenViking`](https://github.com/volcengine/OpenViking) once MVP is verified

## Not yet

- Hook adapters, transcript parser, installer, doctor
- Verified Droid version matrix
- Link from OpenViking community-plugins docs

## License

TBD (likely Apache-2.0 to match OpenViking).
