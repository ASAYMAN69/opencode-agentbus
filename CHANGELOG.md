# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

### Added
- **Zyrun-Native Persistent Orchestration**: Head/sub-agent coordination automating the file-based relay workflow.
- **Single Tool Call `agentbus`**:
  - `action="invoke"`: Synchronous delegation with `<agent id="main" task="...">` and `<agent id="..." task="...">` XML tag envelopes.
  - `action="trigger"`: Asynchronous background dispatch.
  - `action="poke"`: Nudge / status check without task assignment.
  - `action="list"`: Query active sub-agent roster.
- **Head Agent Designation**: `/agentbus-init` command to claim the current session as the HEAD coordinator and inject coordinator rules to the system prompt.
- **Permission & Session Isolation**: Sub-agent sessions are prohibited from re-running `/agentbus-init` or executing the coordinator `agentbus` tool.
- **Visual Badges (TUI)**:
  - Red highlight + gray font ` MAIN ` badge for the head coordinator session.
  - Yellow highlight + black font ` <NAME> ` badge (e.g. `BACKEND`, `FRONTEND`, `TESTER`, `DBMASTER`) for deployed sub-agent sessions.
- **Automatic Skill Indexing**: Pulls relevant specialized skills from `~/.agents/skills` based on role definitions and exposes their paths in sub-agent system instructions.
- **Prompt-Level Scope Restriction**: Enforces write boundaries (e.g. `frontend/**`, `backend/**`) per agent.
