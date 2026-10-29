import { Plugin } from "@opencode/plugin"
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

export default Plugin.define({
  id: "agentbus",

  async setup(ctx) {
    const rootDir = ctx.location.directory

    async function getAgents(): Promise<Record<string, AgentRegistryEntry>> {
      const saved = await ctx.storage.get("agent_registry")
      if (saved && typeof saved === "object") {
        return saved as Record<string, AgentRegistryEntry>
      }
      return {}
    }

    async function saveAgents(registry: Record<string, AgentRegistryEntry>): Promise<void> {
      await ctx.storage.set("agent_registry", registry)
    }

    async function getOrCreateAgentSession(agentId: string): Promise<AgentRegistryEntry> {
      const registry = await getAgents()
      if (registry[agentId]) {
        try {
          const s = await ctx.session.get({ sessionID: registry[agentId].sessionID })
          if (s) return registry[agentId]
        } catch {
          // Session deleted or missing, recreate below
        }
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

=== TASK LIFECYCLE ===
When you receive a task message in the format:
<agent id="main" task="...">[task_content]</agent>

1. Follow the task brief and work within your scope.
2. Complete all work and verification.
3. Write your final summary clearly.
`

      await ctx.session.instructions.entry.put({
        sessionID: session.id,
        key: "agentbus_config",
        value: instructions
      })

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

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "agentbus",
        description: "Zyrun-native persistent multi-agent orchestration tools"
      })

      editor.add({
        name: "invoke",
        description: "Assign a task to a persistent sub-agent (frontend, backend, tester, dbmaster, etc.) and wait for its completion. Returns <agent id=... task=...>[finalOutput]</agent>.",
        input: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description: "Target agent ID (e.g., 'frontend', 'backend', 'tester', 'dbmaster')"
            },
            task: {
              type: "string",
              description: "Task identifier or brief slug (e.g., '01-crm-schema', 'fix-nav')"
            },
            message: {
              type: "string",
              description: "Task instructions and details to relay to the agent"
            },
            taskFilePath: {
              type: "string",
              description: "Optional relative path to task file (e.g., 'frontend/AGENT/TASK.md' or 'sub-agent/01-task.md')"
            }
          },
          required: ["agent", "task", "message"],
          additionalProperties: false
        },
        options: { namespace: "agentbus" },
        execute: async (input, context) => {
          const { agent, task, message, taskFilePath } = input as {
            agent: string
            task: string
            message: string
            taskFilePath?: string
          }

          if (taskFilePath) {
            const absTaskPath = path.resolve(rootDir, taskFilePath)
            await fs.mkdir(path.dirname(absTaskPath), { recursive: true })
            await fs.writeFile(absTaskPath, message, "utf-8")
          }

          const target = await getOrCreateAgentSession(agent)

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

          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]
            if (m.agent === agent || (m as any).role === "assistant" || (m as any).author === "assistant") {
              const body = (m as any).text || (m as any).content || JSON.stringify(m)
              lastAssistantText = typeof body === "string" ? body : JSON.stringify(body)
              break
            }
          }

          return {
            content: `<agent id="${agent}" task="${task}">
${lastAssistantText}
</agent>`
          }
        }
      })

      editor.add({
        name: "trigger",
        description: "Trigger a persistent sub-agent in background (fire-and-forget). Returns immediately.",
        input: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description: "Target agent ID"
            },
            task: {
              type: "string",
              description: "Task identifier"
            },
            message: {
              type: "string",
              description: "Task instructions"
            }
          },
          required: ["agent", "task", "message"],
          additionalProperties: false
        },
        options: { namespace: "agentbus" },
        execute: async (input) => {
          const { agent, task, message } = input as {
            agent: string
            task: string
            message: string
          }

          const target = await getOrCreateAgentSession(agent)
          const promptPayload = `<agent id="main" task="${task}">
${message}
</agent>`

          await ctx.session.prompt({
            sessionID: target.sessionID,
            text: promptPayload,
            delivery: "steer"
          })

          return {
            content: `Triggered background agent [${agent}] for task "${task}".`
          }
        }
      })

      editor.add({
        name: "poke",
        description: "Nudge or check status of an idle sub-agent without assigning a new task.",
        input: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description: "Target agent ID"
            },
            note: {
              type: "string",
              description: "Status check note or reminder"
            }
          },
          required: ["agent"],
          additionalProperties: false
        },
        options: { namespace: "agentbus" },
        execute: async (input) => {
          const { agent, note } = input as { agent: string; note?: string }
          const target = await getOrCreateAgentSession(agent)

          await ctx.session.prompt({
            sessionID: target.sessionID,
            text: note || "Please report your current task status.",
            delivery: "steer"
          })

          return {
            content: `Poked agent [${agent}].`
          }
        }
      })

      editor.add({
        name: "list_agents",
        description: "List all configured persistent sub-agents, their session IDs, roles, and write scopes.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        options: { namespace: "agentbus" },
        execute: async () => {
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
      })
    })

    return () => {
      // Cleanup on unload
    }
  }
})
