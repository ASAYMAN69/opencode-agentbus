# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-10-30

### Fixed
- **ASI Parsing Bug on Dispatch**:
  - Replaced IIFE with `void monitorTask()` to prevent JavaScript Automatic Semicolon Insertion from parsing `activeTasks.set(...)(async () => ...)` as an invalid function invocation.
- **Sub-Agent Blank Session & Instruction Injection**:
  - Automatically injects dynamic sub-agent role, working directory, write boundaries, and skills into `event.system` via `hook("context")` and `hook("compaction")`.
  - Dispatches an initial synthetic banner when sub-agents are provisioned to prevent empty/dead sessions in the UI.
- **Cleanup on Delete**:
  - Purges `activeTasks` and `agent_statuses` when an agent is deleted.

### Added
- **AI Agent Handoff Guide**:
  - Added comprehensive `HANDOFF.md` detailing system architecture, plugin lifecycle, file locations, mechanics, and operational rules for incoming AI agents and developers.

## [0.1.2] - 2026-10-30

### Fixed
- Dynamic subagent instruction injection via context/compaction hook.
- Added session banner and coordinator delegation rules.

## [0.1.1] - 2026-10-30

### Added
- **Interruption Detection & Notification**:
  - Automatically detects when a sub-agent is interrupted mid-task (due to user cancel, provider interrupt, tool failure, or session error).
  - Emits a synthetic alert directly to the user: `Sub-agent '<agentId>' was interrupted during task '<task>'`.
  - Notifies the main coordinator with `<agent id="..." task="..." status="interrupted">` instead of falsely reporting task completion.
  - Displays `✗ interrupted: <task>` in the right sidebar process view.
- **`/agentbus-init <extra text>` User Message Turn**:
  - Trailing text after `/agentbus-init` (e.g. `/agentbus-init delegate 3 sub agents immediately`) is automatically forwarded as a standard user chat turn.

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
