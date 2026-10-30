# AgentBus: Monorepo/Multi-Repo Delegation Plan (pending approval)

## Repo-type detection (main agent, before delegating)
- If project has >1 `.git` OR top-level looks like frontend/backend/admin → MULTI-REPO.
- If project has 1 `.git` and base contains src/lib/etc → MONOREPO.
- If ambiguous → ask the user.

## MULTI-REPO flow
- One agent per repo. Each repo keeps its own AGENTS/ directory (TASKS, COMPLETIONS, CONTEXT).
- Task files: `<repo>/AGENTS/TASKS/<agent>-<slug>.md`.
- Agent works in its repo on a new branch, pushes branch, opens PR. Main reviews/merges.

## MONOREPO flow (ask user approval first)
1. Prep: ensure `abcd` has git origin and latest is pushed.
2. Copy secrets to all replicas.
3. For N writer agents: create `abcd-<agent>/` dirs, each `git clone` of the repo.
   Each clone has its own `.git` (full isolation). Base `abcd/` loses `.git` (codebase gone; only coordinator space remains).
4. Delegate: task files go in `abcd-<agent>/AGENTS/TASKS/<agent>-<slug>.md`.
   Each agent works in its clone on a new branch (never master), pushes branch, opens PR.
5. Review/merge: main agent reviews PRs + CI, merges passing to master/main.
6. Sync: pull latest master into each clone after merges.

## Agent obligations
- Use abgit for all git ops (runs in agent's own clone cwd).
- Never commit/push to master directly; branch → commit → push branch → PR.
- Write summary (incl. PR URL/branch) to designated completion file.
- Read context files only when main agent explicitly says so.

## Main agent obligations
- Detect repo type; ask if ambiguous.
- For monorepo, propose plan and wait for user approval before cloning.
- Stay in base dir (coordinator space) for orchestration.

## Approval
Reply "approve" to implement prompt changes.