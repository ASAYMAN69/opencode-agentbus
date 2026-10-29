import * as fs from "node:fs/promises"
import * as path from "node:path"

interface AgentRegistryEntry {
  id: string
  sessionID: string
  role: string
  workingDirectory: string
  writeScope: string[]
  skills: string[]
}

const DEFAULT_AGENTS: Record<string, { role: string; workingDirectory: string; writeScope: string[]; skills: string[] }> = {
  frontend: {
    role: "Frontend engineer. Works only in frontend/. Implements UI, components, stores, and frontend tests.",
    workingDirectory: "frontend",
    writeScope: ["frontend/**"],
    skills: ["design-taste-frontend", "fast-typecheck-and-build"]
  },
  backend: {
    role: "Backend engineer. Works only in backend/. Implements APIs, routes, services, schemas, and migrations.",
    workingDirectory: "backend",
    writeScope: ["backend/**"],
    skills: ["api-and-interface-design", "debugging-and-error-recovery"]
  },
  tester: {
    role: "Independent verification agent. Verifies changes independently across repos. Makes no product edits.",
    workingDirectory: ".",
    writeScope: ["AGENTS/TEST_REPORTS/**", "test/**"],
    skills: ["code-review-and-quality"]
  },
  dbmaster: {
    role: "Schema, migration, index, constraint authority and review gate.",
    workingDirectory: ".",
    writeScope: ["AGENTS/DB_REVIEWS/**", "backend/src/db/**"],
    skills: ["domain-modeling"]
  }
}

async function loadSkillsIndex(skillNames: string[]): Promise<string> {
  const home = process.env.HOME || "/home/asayman"
  const skillsBase = path.join(home, ".agents", "skills")
  const lines: string[] = []

  for (const name of skillNames) {
    const skillPath = path.join(skillsBase, name, "SKILL.md")
    try {
      const content = await fs.readFile(skillPath, "utf-8")
      const descMatch = content.match(/description:\s*(.+)/i)
      const desc = descMatch ? descMatch[1].trim() : "Custom specialized skill"
      lines.push(`- Skill: ${name} (Path: ${skillPath})\n  Description: ${desc}`)
    } catch {
      lines.push(`- Skill: ${name} (Path: ${skillPath})`)
    }
  }

  return lines.length > 0
    ? `### Available Skills\nYou have access to the following skills. Read their SKILL.md for instructions when relevant:\n${lines.join("\n")}\n`
    : ""
}

export default {
  id: "agentbus",
  async setup(ctx: any) {
    const rootDir = ctx.location?.directory || process.cwd()

    async function getHeadSessionID(): Promise<string | undefined> {
      try {
        const saved = await ctx.storage.get("head_session_id")
        return typeof saved === "string" ? saved : undefined
      } catch {
        return undefined
      }
    }

    async function setHeadSessionID(sessionID: string): Promise<void> {
      await ctx.storage.set("head_session_id", sessionID)
    }

    async function getAgents(): Promise<Record<string, AgentRegistryEntry>> {
      try {
        const saved = await ctx.storage.get("agent_registry")
        if (saved && typeof saved === "object") {
          return saved as Record<string, AgentRegistryEntry>
        }
      } catch {}
      return {}
    }

    async function saveAgents(registry: Record<string, AgentRegistryEntry>): Promise<void> {
      try {
        await ctx.storage.set("agent_registry", registry)
      } catch {}
    }

    async function isSubAgentSession(sessionID: string): Promise<boolean> {
      const registry = await getAgents()
      return Object.values(registry).some((a) => a.sessionID === sessionID)
    }

    async function getOrCreateAgentSession(agentId: string): Promise<AgentRegistryEntry> {
      const registry = await getAgents()
      if (registry[agentId]) {
        try {
          const s = await ctx.session.get({ sessionID: registry[agentId].sessionID })
          if (s) return registry[agentId]
        } catch {}
      }

      const template = DEFAULT_AGENTS[agentId] || {
        role: `Specialized agent for ${agentId}`,
        workingDirectory: agentId,
        writeScope: [`${agentId}/**`],
        skills: []
      }

      const session = await ctx.session.create({
        title: `AgentBus: ${agentId}`
      })

      const skillsText = await loadSkillsIndex(template.skills)
      const scopeText = template.writeScope.map((s) => `- ${s}`).join("\n")

      const instructions = `You are persistent sub-agent: [${agentId.toUpperCase()}].
Role: ${template.role}
Working Directory: ${template.workingDirectory}

=== WRITE ACCESS CONSTRAINT (STRICT) ===
You are authorized to write and edit ONLY inside your allowed scope:
${scopeText}
Do NOT edit or write files outside this scope under any circumstances. If you need modifications outside your scope, report back to the main agent.

${skillsText}

=== TASK PROTOCOL ===
You receive tasks in the format:
<agent id="main" task="...">[task_content]</agent>

1. Follow the task brief and work strictly within your scope.
2. Complete all work and verification.
3. Finish with your clear summary.
`

      try {
        if (ctx.session.instructions?.entry?.put) {
          await ctx.session.instructions.entry.put({
            sessionID: session.id,
            key: "agentbus_config",
            value: instructions
          })
        } else {
          await ctx.session.prompt({
            sessionID: session.id,
            text: instructions
          })
        }
      } catch {}

      const entry: AgentRegistryEntry = {
        id: agentId,
        sessionID: session.id,
        role: template.role,
        workingDirectory: template.workingDirectory,
        writeScope: template.writeScope,
        skills: template.skills
      }

      registry[agentId] = entry
      await saveAgents(registry)
      return entry
    }

    // Command to elect the current session as the HEAD coordinator agent
    if (ctx.command?.transform) {
      await ctx.command.transform((cmdEditor: any) => {
        cmdEditor.add({
          name: "agentbus-init",
          description: "Initialize and claim the current session as the HEAD coordinator agent",
          execute: async ({ sessionID }: any) => {
            // Guard: Sub-agents are never allowed to run or claim HEAD
            if (await isSubAgentSession(sessionID)) {
              await ctx.session.synthetic({
                sessionID,
                text: "Error: Sub-agent sessions are forbidden from executing agentbus-init."
              })
              return
            }

            const currentHead = await getHeadSessionID()
            if (currentHead && currentHead !== sessionID) {
              await ctx.session.synthetic({
                sessionID,
                text: `AgentBus: A HEAD agent session is already designated (\`${currentHead}\`). Re-assigning HEAD to this session (\`${sessionID}\`).`
              })
            }

            await setHeadSessionID(sessionID)

            // Inject coordinator instructions to the bottom of the system prompt / instructions
            const headInstructions = `
=== AGENTBUS HEAD COORDINATOR MODE ===
You are the designated HEAD agent for AgentBus.
You coordinate and delegate work to persistent sub-agents (frontend, backend, tester, dbmaster) using the single tool call: \`agentbus\`.

When delegating:
Call \`agentbus\` with action="invoke" (or "trigger") to relay tasks in the format:
<agent id="main" task="...">[task instructions]</agent>

Sub-agents work within their dedicated sessions and reply with:
<agent id="[agent_id]" task="...">[agentFinalOutput]</agent>
`
            try {
              if (ctx.session.instructions?.entry?.put) {
                await ctx.session.instructions.entry.put({
                  sessionID,
                  key: "agentbus_head_instructions",
                  value: headInstructions
                })
              }
            } catch {}

            await ctx.session.synthetic({
              sessionID,
              text: "AgentBus initialized. This session is now the designated HEAD coordinator agent. The `agentbus` tool is active."
            })
          }
        })
      })
    }

    // Hook session context to inject system instructions at the very bottom
    if (ctx.session?.hook) {
      try {
        await ctx.session.hook("context", async (event: any) => {
          const currentHead = await getHeadSessionID()
          if (currentHead && event.sessionID === currentHead) {
            event.system = event.system || []
            event.system.push({
              type: "text",
              text: `\n=== AGENTBUS HEAD COORDINATOR ACTIVE ===\nYou have the \`agentbus\` tool available to invoke, trigger, or poke persistent sub-agents (frontend, backend, tester, dbmaster).`
            })
          }
        })
      } catch {}
    }

    // Unified single tool call: "agentbus"
    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "agentbus",
        description: "Coordinate, invoke, trigger, or check persistent sub-agents (frontend, backend, tester, dbmaster). Only executable from the designated HEAD session.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["invoke", "trigger", "poke", "list"],
              description: "Action to perform: 'invoke' (synchronous wait), 'trigger' (asynchronous fire-and-forget), 'poke' (status check nudge), or 'list' (view all sub-agents)"
            },
            agent: {
              type: "string",
              description: "Target sub-agent identifier: 'frontend', 'backend', 'tester', 'dbmaster', or any custom sub-agent name"
            },
            task: {
              type: "string",
              description: "Task title, brief identifier, or slug (e.g., '01-crm-schema', 'fix-nav')"
            },
            message: {
              type: "string",
              description: "Task brief, instructions, and acceptance criteria to relay to the sub-agent"
            },
            taskFilePath: {
              type: "string",
              description: "Optional task file path to mirror the brief on disk (e.g., 'backend/AGENT/TASK.md' or 'sub-agent/01-task.md')"
            },
            note: {
              type: "string",
              description: "Optional note or reminder when using action='poke'"
            }
          },
          required: ["action"],
          additionalProperties: false
        },
        execute: async (input: any, context: any) => {
          const sessionID = context?.sessionID
          const currentHead = await getHeadSessionID()

          // Enforcement: If HEAD session is set, reject any call coming from other sessions (e.g. sub-agents)
          if (currentHead && sessionID && sessionID !== currentHead) {
            return {
              content: `Error: The 'agentbus' tool is restricted to the designated HEAD coordinator session (${currentHead}). This session (${sessionID}) is not authorized.`
            }
          }

          const { action, agent, task, message, taskFilePath, note } = input

          if (action === "list") {
            const registry = await getAgents()
            const list = Object.values(registry).map((a) => ({
              id: a.id,
              sessionID: a.sessionID,
              role: a.role,
              workingDirectory: a.workingDirectory,
              writeScope: a.writeScope,
              skills: a.skills
            }))
            return {
              content: JSON.stringify(list, null, 2)
            }
          }

          if (!agent) {
            return {
              content: "Error: 'agent' argument is required for actions 'invoke', 'trigger', and 'poke'."
            }
          }

          const target = await getOrCreateAgentSession(agent)

          if (action === "poke") {
            await ctx.session.prompt({
              sessionID: target.sessionID,
              text: note || "Please report your current task status.",
              delivery: "steer"
            })
            return {
              content: `Poked sub-agent [${agent}].`
            }
          }

          if (action === "trigger") {
            if (!task || !message) {
              return {
                content: "Error: Both 'task' and 'message' are required for action='trigger'."
              }
            }

            if (taskFilePath) {
              const absTaskPath = path.resolve(rootDir, taskFilePath)
              await fs.mkdir(path.dirname(absTaskPath), { recursive: true })
              await fs.writeFile(absTaskPath, message, "utf-8")
            }

            const promptPayload = `<agent id="main" task="${task}">
${message}
</agent>`

            await ctx.session.prompt({
              sessionID: target.sessionID,
              text: promptPayload,
              delivery: "steer"
            })

            return {
              content: `Triggered background sub-agent [${agent}] for task "${task}".`
            }
          }

          if (action === "invoke") {
            if (!task || !message) {
              return {
                content: "Error: Both 'task' and 'message' are required for action='invoke'."
              }
            }

            if (taskFilePath) {
              const absTaskPath = path.resolve(rootDir, taskFilePath)
              await fs.mkdir(path.dirname(absTaskPath), { recursive: true })
              await fs.writeFile(absTaskPath, message, "utf-8")
            }

            const promptPayload = `<agent id="main" task="${task}">
${message}
</agent>`

            await ctx.session.prompt({
              sessionID: target.sessionID,
              text: promptPayload
            })

            await ctx.session.wait({ sessionID: target.sessionID })

            const messages = await ctx.session.context({ sessionID: target.sessionID })
            let lastAssistantText = "Task completed."

            if (Array.isArray(messages)) {
              for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i]
                if (m.agent === agent || m.role === "assistant" || m.author === "assistant") {
                  const body = m.text || m.content || JSON.stringify(m)
                  lastAssistantText = typeof body === "string" ? body : JSON.stringify(body)
                  break
                }
              }
            }

            return {
              content: `<agent id="${agent}" task="${task}">
${lastAssistantText}
</agent>`
            }
          }

          return {
            content: `Unknown action '${action}'. Supported: invoke, trigger, poke, list.`
          }
        }
      })
    })

    return () => {}
  }
}
