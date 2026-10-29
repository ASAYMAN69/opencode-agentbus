# AgentBus

OpenCode v2 plugin for persistent multi-agent workforce orchestration.

## What it does
- Designates a HEAD coordinator session via `/agentbus-init`.
- Lets the coordinator create, delegate to, and monitor persistent sub-agent sessions using the single `agentbus` tool.
- Shoot-and-forget dispatch with autonomous completion/interruption notifications.
- Per-agent working directories, write scopes, and TUI status indicators.

## Install
1. Copy `.opencode/plugins/agentbus/` to `~/.config/opencode/plugins/agentbus/`.
2. Register in `~/.config/opencode/opencode.json`.
3. Restart OpenCode.

See `HANDOFF.md` for architecture details.