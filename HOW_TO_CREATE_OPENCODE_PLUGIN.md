# Skill: Create an OpenCode Plugin

## Purpose

Use this skill when the user asks to create, modify, install, debug, or explain an OpenCode plugin.

An OpenCode plugin is a JavaScript or TypeScript module that extends OpenCode by:

- Subscribing to events such as session, file, tool, permission, LSP, message, shell, and TUI events.
- Intercepting and modifying live operations, especially tool execution.
- Adding custom tools, commands, agents, providers, models, MCP servers, skills, references, integrations, and VCS/worktree strategies.
- Integrating external services through APIs, OAuth, API keys, or shell commands.
- Extending the terminal UI through a separate CLI/TUI plugin.

Official documentation is the source of truth:
- V1/current stable plugin docs: https://opencode.ai/docs/plugins/
- V2 plugin authoring: https://opencode.ai/v2/docs/build/plugins
- V2 plugin configuration: https://opencode.ai/v2/docs/plugins
- V2 CLI/TUI plugin docs: https://opencode.ai/v2/docs/build/plugins/cli/

## First Decision: V1 or V2

Determine which plugin API the user’s OpenCode installation uses.

| Situation | Use |
|---|---|
| User has current stable OpenCode and wants event hooks such as `tool.execute.before`, `session.idle`, or `shell.env` | V1-style plugin |
| User wants transforms for agents, providers, models, commands, integrations, MCP, skills, tools, VCS, or worktrees | V2 plugin |
| User wants to change the terminal interface | CLI/TUI plugin |
| User wants both server behavior and terminal UI | Server plugin plus `./tui` entrypoint |

If uncertain, create a V1-compatible plugin first because it is documented in the stable plugin guide, then add V2 APIs only if the user’s OpenCode version supports them.

## Plugin Locations and Loading

### Automatic discovery

Place local plugin files in one of these directories:

- Project-level: `.opencode/plugins/`
- Global/user-level: `~/.config/opencode/plugins/`

OpenCode automatically loads `.ts` and `.js` files and immediate plugin package directories found there at startup. [6][17]

Example layout:

```text
.opencode/
└── plugins/
    ├── my-plugin.ts
    ├── reviewer.js
    └── acme-package/
        └── index.ts
```

### Explicit configuration

For npm packages, scoped packages, versioned packages, or plugin directories outside `.opencode/plugins/`, add them to `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "$schema": "[https://opencode.ai/config.json](https://opencode.ai/config.json)",
  "plugins": [
    "opencode-acme-plugin",
    "opencode-acme-plugin@1.2.0",
    "@acme/opencode-plugin",
    "./plugins/local",
    "/absolute/path/plugin",
    {
      "package": "@acme/opencode-plugin",
      "options": {
        "strict": true
      }
    }
  ]
}
```

Configured local paths must be directories. OpenCode loads the directory’s `server` or `index` module, such as `index.ts`; a path to a single file is skipped. [17]

### Load order

Plugins load from all sources, and hooks run in sequence:

1. Global config: `~/.config/opencode/opencode.json`
2. Project config: `opencode.json`
3. Global plugin directory: `~/.config/opencode/plugins/`
4. Project plugin directory: `.opencode/plugins/` [6]

### Dependencies

For a local plugin that needs npm packages, create a `package.json` in the relevant config directory:

```json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

For project-local plugins, use `.opencode/package.json`. OpenCode runs `bun install` at startup. [6]

### Package plugin management

Use these commands for package-based plugins:

```bash
opencode plugin add opencode-acme-plugin@1.2.0
opencode plugin list
opencode plugin list --builtin
opencode plugin check
opencode plugin update
opencode plugin update opencode-acme-plugin
opencode plugin remove opencode-acme-plugin@1.2.0
```

Package installation supports npm names, versions, tags, ranges, and npm-compatible Git specifications. [17]

## V1 Plugin Structure

A V1 plugin is a JavaScript/TypeScript module exporting one or more async plugin functions. Each function receives a context and returns a hooks object. [6]

```ts
// .opencode/plugins/example.ts
import type { Plugin } from "@opencode-ai/plugin"

export const ExamplePlugin: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  return {
    // Hooks go here.
  }
}
```

### V1 plugin context

| Property | Meaning | Typical use |
|---|---|---|
| `project` | Current project information | Identify or scope behavior to a project |
| `directory` | Current working directory | Resolve relative paths |
| `worktree` | Git worktree path | Git-aware behavior |
| `client` | OpenCode SDK client | Call OpenCode APIs, log structured messages |
| `$` | Bun shell API | Run local commands safely |

Use `client.app.log()` rather than `console.log` for structured logging:

```ts
await client.app.log({
  body: {
    service: "my-plugin",
    level: "info",
    message: "Plugin initialized",
    extra: { foo: "bar" },
  },
})
```

Log levels are `debug`, `info`, `warn`, and `error`. [6]

## V1 Event Hooks

Use the `event` hook to observe OpenCode events. Do not use it to block or transform an operation; use a dedicated hook for that.

```ts
export const NotificationPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

### Complete V1 event list

#### Command events

- `command.executed`

Use when: auditing, logging, or reacting after a command runs.

#### File events

- `file.edited`
- `file.watcher.updated`

Use when: tracking changed files, triggering formatting, syncing external state, or updating caches.

#### Installation events

- `installation.updated`

Use when: reacting to OpenCode installation or version changes.

#### LSP events

- `lsp.client.diagnostics`
- `lsp.updated`

Use when: surfacing diagnostics, collecting language-server state, or building quality gates.

#### Message events

- `message.part.removed`
- `message.part.updated`
- `message.removed`
- `message.updated`

Use when: tracking conversation changes, syncing message state, or building UI/history integrations.

#### Permission events

- `permission.asked`
- `permission.replied`

Use when: logging permission prompts, notifying users, or integrating approval workflows.

#### Server events

- `server.connected`

Use when: initializing connections or checking server availability.

#### Session events

- `session.created`
- `session.compacted`
- `session.deleted`
- `session.diff`
- `session.error`
- `session.idle`
- `session.status`
- `session.updated`

Use when:
- `session.created`: initialize per-session state.
- `session.compacted`: react after context compaction.
- `session.deleted`: clean up session-scoped data.
- `session.diff`: inspect repository or session diffs.
- `session.error`: alert or record failures.
- `session.idle`: notify the user, run follow-up automation, or finalize work.
- `session.status`: track active/idle or execution state.
- `session.updated`: synchronize metadata or external dashboards. [6]

#### Todo events

- `todo.updated`

Use when: syncing task lists to external trackers or displaying progress.

#### Shell events

- `shell.env`

Use when: injecting environment variables into AI tools and user terminals.

```ts
export const InjectEnvPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
      output.env.PROJECT_ROOT = input.cwd
    },
  }
}
```

#### Tool events

- `tool.execute.before`
- `tool.execute.after`

Use when:
- `tool.execute.before`: validate, block, rewrite, or add guardrails before a tool runs.
- `tool.execute.after`: audit results, collect metrics, or trigger follow-up actions.

Example: prevent reading `.env` files.

```ts
export const EnvProtection = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

#### TUI events

- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

Use when: integrating with terminal prompts, commands, or toast notifications. For rich terminal extensions, prefer a dedicated CLI/TUI plugin. [6]

## V1 Custom Tools

Add a tool through the `tool` property in the returned hooks object.

```ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string(),
        },
        async execute(args, context) {
          const { directory, worktree } = context
          return `Hello ${args.foo} from ${directory} (worktree: ${worktree})`
        },
      }),
    },
  }
}
```

Rules:

- `description` tells the model when to use the tool.
- `args` uses a Zod-style schema.
- `execute` receives validated arguments and execution context.
- A plugin tool with the same name as a built-in tool takes precedence. [6]

## V1 Compaction Hook

Use `experimental.session.compacting` to customize what survives compaction.

```ts
export const CompactionPlugin: Plugin = async () => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`
## Custom Context
Preserve:
- Current task status
- Important decisions
- Files being modified
- Next steps
`)
    },
  }
}
```

To replace the entire compaction prompt, set `output.prompt`. When `output.prompt` is set, `output.context` is ignored. [6]

## V2 Plugin Structure

V2 plugins use `Plugin.define`, a stable plugin `id`, and a `setup(ctx)` lifecycle function.

```ts
// .opencode/plugins/example/index.ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "example",
  async setup(ctx) {
    await ctx.storage.set("loaded", true)
  },
})
```

`setup` runs when the plugin loads. It may return a cleanup function that runs when the plugin unloads. [11]

```ts
export default Plugin.define({
  id: "example",
  setup(ctx) {
    return () => {
      // cleanup
    }
  },
})
```

### V2 context

The V2 context is essentially an OpenCode server client, plus plugin-only capabilities for transforms, runtime hooks, reloads, registrations, and options. [11]

Important properties:

| Property | Use |
|---|---|
| `ctx.app` | App metadata, including version |
| `ctx.location` | Plugin instance location, directory, workspace, and project metadata |
| `ctx.options` | Options passed through the object form in `opencode.json(c)` |
| `ctx.client` | OpenCode client for server calls |
| `ctx.storage` | Durable plugin-scoped JSON storage |
| `ctx.permission` | Permission checks and request handling |
| `ctx.generate` | Model text generation without creating a session |
| `ctx.event` | Event subscription |
| Domain APIs | Agent, provider, model, command, integration, credential, MCP, plugin, reference, session, skill, tool, VCS, worktree, websearch |

### V2 options

Configure options like this:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/company",
      "options": {
        "strict": true
      }
    }
  ]
}
```

Read them in setup:

```ts
setup(ctx) {
  const strict = ctx.options.strict === true
}
```

[11]

## V2 API Domains

Treat each domain below as an interface group. Prefer the narrowest domain that solves the user’s request.

### Agent

Read, inspect, transform, and reload agents.

```ts
const agents = await ctx.agent.list()
const build = await ctx.agent.get({ agentID: "build" })

await ctx.agent.transform((editor) => {
  editor.default("build")
  editor.update("build", (agent) => {
    agent.description = "Builds features and fixes bugs"
  })
  editor.remove("legacy")
})

await ctx.agent.reload()
```

Use when: changing the default agent, editing agent metadata, removing obsolete agents, or building custom agent workflows. [11]

### Provider

Read providers and transform provider definitions and model inventories.

```ts
const providers = await ctx.provider.list()
const provider = await ctx.provider.get({ providerID: "anthropic" })

await ctx.provider.transform((editor) => {
  editor.update("anthropic", (provider) => {
    provider.headers = { ...provider.headers, "x-company": "engineering" }
  })
  editor.models.update("anthropic", "claude-sonnet-5-5", (model) => {
    model.name = "Team Sonnet"
  })
})
```

Use when: adding an OpenAI-compatible provider, changing headers or settings, supplying custom model inventories, or removing providers/models. Call `ctx.provider.reload()` after external source data changes. [11]

### Model

Read models and transform the active model candidate collection.

```ts
const models = await ctx.model.list()
const selected = await ctx.model.default()

await ctx.model.transform((editor) => {
  editor.default.set("anthropic", "claude-sonnet-5-5")
  editor.remove("anthropic", "legacy-model")
})
```

Use when: filtering expensive models, disabling unsupported models, changing defaults, or enforcing model policies. [11]

### Command

Read and register slash/palette-style commands.

```ts
await ctx.command.transform((editor) => {
  editor.add({
    name: "security-review",
    description: "Review changes for security issues",
    execute: async ({ sessionID, prompt, delivery }) => {
      await ctx.session.prompt({
        ...prompt,
        sessionID,
        text: `Review these changes for security issues.\n\n${prompt.text}`,
        delivery,
      })
    },
  })
})
```

Use when: adding repeatable user-invoked workflows. The executor receives `sessionID`, prompt attachments, and `delivery`, which is either `"steer"` or `"queue"`. [11]

### Integration

Read integrations, inspect credentials, connect API-key or OAuth-based services, and manage authentication methods.

```ts
const integrations = await ctx.integration.list()
const github = await ctx.integration.get({ integrationID: "github" })
const connection = await ctx.integration.connection.active("github")

await ctx.integration.connect.key({
  integrationID: "github",
  key: process.env.GITHUB_TOKEN!,
})
```

OAuth flow:

```ts
const attempt = await ctx.integration.oauth.connect({
  integrationID: "github",
  methodID: "oauth",
})

const status = await ctx.integration.oauth.status({
  integrationID: "github",
  attemptID: attempt.data.attemptID,
})

await ctx.integration.oauth.complete({
  integrationID: "github",
  attemptID: attempt.data.attemptID,
  code,
})
```

Use when: adding service authentication, custom login methods, account-specific provider discovery, or external-service connections. [11]

### Credential

Activate a saved credential for an integration.

```ts
await ctx.credential.activate({ credentialID })
```

Use when: selecting among multiple saved credentials. [11]

### MCP

List and transform MCP server configuration.

```ts
const servers = await ctx.mcp.list()

await ctx.mcp.transform((editor) => {
  editor.set("docs", {
    type: "remote",
    url: "[https://mcp.example.com](https://mcp.example.com)",
  })

  editor.update("docs", (server) => {
    server.disabled = false
  })
})
```

Use when: adding, replacing, enabling, disabling, or removing MCP servers. OpenCode reconciles server lifecycle from the transformed configuration. [11]

### Plugin

List active plugins for a location.

```ts
const plugins = await ctx.plugin.list()
```

Use when: building plugin-management UIs or checking whether another plugin is active. [11]

### Reference

Read and transform local or Git reference sources.

```ts
await ctx.reference.transform((editor) => {
  editor.add("handbook", {
    type: "local",
    path: "/workspace/docs/handbook",
  })

  editor.add("standards", {
    type: "git",
    repository: "[https://github.com/acme/standards](https://github.com/acme/standards)",
    branch: "main",
  })
})
```

Use when: dynamically supplying project documentation, standards, or external knowledge sources. [11]

### Generate

Generate text with a selected model without creating a session, invoking tools, or adding to session history.

```ts
const review = await ctx.generate.text({
  model: { providerID: "anthropic", id: "claude-sonnet-5-5" },
  prompt: "Review this proposed action.",
})
```

Use when: performing side tasks such as classification, summarization, review, or validation without polluting the user’s session. [11]

### Permission

Ask for permission, inspect pending requests, reply to requests, and replace session permission rules.

```ts
await ctx.permission.assert({
  sessionID: context.sessionID,
  agent: context.agent,
  source: {
    type: "tool",
    messageID: context.messageID,
    id: context.id,
  },
  action: "deploy",
  resources: [input.environment],
  save: [input.environment],
})
```

Also available:

```ts
const pending = await ctx.permission.list({ sessionID })
const request = await ctx.permission.get({ sessionID, requestID })
await ctx.permission.reply({ sessionID, requestID, decision: "once" })
```

Use when: gating destructive actions, requiring approval for deployments, or implementing custom approval UX. A configured `deny` is final and does not invoke permission hooks; hooks may change `effect` among `allow`, `ask`, and `deny`. [11]

### Session

Create, read, update, prompt, interrupt, compact, and remove sessions.

```ts
const created = await ctx.session.create({ title: "Review" })
const session = await ctx.session.get({ sessionID })
const messages = await ctx.session.context({ sessionID })

await ctx.session.switchAgent({ sessionID, agent: "build" })
await ctx.session.switchModel({
  sessionID,
  model: { providerID: "anthropic", id: "claude-sonnet-5-5" },
})

await ctx.session.prompt({ sessionID, text: "Review the current changes" })
await ctx.session.generate({ sessionID, prompt: "Summarize this project" })
await ctx.session.command({ sessionID, name: "review", text: "--staged" })
await ctx.session.synthetic({ sessionID, text: "Deployment completed" })
await ctx.session.interrupt({ sessionID, resume: false })
await ctx.session.wait({ sessionID })
await ctx.session.compact({ sessionID })
await ctx.session.remove({ sessionID })
```

Use when:
- Creating background or orchestration sessions.
- Reading conversation context.
- Switching agent/model.
- Sending prompts, commands, synthetic status messages, or transient generation requests.
- Interrupting, waiting for, compacting, or removing sessions. [11]

### Skill

Read and transform available skills.

```ts
import { Skill } from "@opencode/plugin"

await ctx.skill.transform((editor) => {
  editor.add({
    id: Skill.ID.make("review"),
    name: Skill.Name.make("Review"),
    description: "Review the current changes",
    path: Skill.Info.fields.path.make(
      "/workspace/.opencode/skills/review/SKILL.md"
    ),
    content: "Review the current changes for correctness and missing tests.",
  })

  editor.update("review", (skill) => {
    skill.autoinvoke = true
  })
})
```

Use when: dynamically registering project-specific skills or managing skill availability. [11]

### Storage

Store durable JSON values scoped to the plugin.

```ts
await ctx.storage.set("settings", { strict: true })
const settings = await ctx.storage.get("settings")
await ctx.storage.remove("settings")

const page = await ctx.storage.scan({
  prefix: "cache/",
  limit: 100,
})
```

Use when: persisting settings, caches, tokens, indexes, or small state across restarts. Do not store large blobs or secrets unnecessarily. [11]

### Tool

Read, register, update, remove, namespace, and reload tools.

```ts
const registration = await ctx.tool.transform((editor) => {
  editor.namespace({
    name: "acme",
    description: "Customer account tools",
  })

  editor.add({
    name: "greeting",
    description: "Create a greeting",
    input: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    options: {
      namespace: "acme",
      codemode: true,
    },
    execute: async (input, context) => {
      await context.progress({ status: "greeting" })
      return { content: `Hello ${(input as { name: string }).name}!` }
    },
  })
})
```

Use when: adding custom capabilities to the model, wrapping external APIs, or overriding a tool name. Use `context.signal` for cancellable asynchronous work. Dispose the registration when the transform should no longer apply. [11]

### VCS

Read repository information, branches, working-copy status, and diffs; register custom VCS providers.

```ts
const info = await ctx.vcs.get()
const branches = await ctx.vcs.branch.list({ search: "feature", limit: 10 })
const changes = await ctx.vcs.status()
const diff = await ctx.vcs.diff({ mode: "working", context: 3 })
```

Use when: building Git-aware automation, custom VCS integrations, review tooling, or repository-status UIs. [11]

### Worktree

Register custom local worktree strategies and manage worktrees.

```ts
await ctx.worktree.transform((editor) => {
  editor.add(strategy)
})

const projectID = ctx.location.project.id
const created = await ctx.worktree.create({ projectID, name: "task" })
const inventory = await ctx.worktree.list({ projectID })
await ctx.worktree.refresh({ projectID })
await ctx.worktree.remove({
  projectID,
  directory: created.directory,
  force: false,
})
```

Use when: implementing non-Git worktree backends or custom local workspace strategies. Worktree strategies manage local directories; remote workspace provisioning is not part of this interface. [11]

### Websearch

List websearch providers or run queries.

```ts
const providers = await ctx.websearch.providers()

const results = await ctx.websearch.query({
  query: "OpenCode plugins",
  providerID: "internal",
})
```

Use when: adding a search provider or performing web research from a plugin. [11]

## V2 Runtime Hooks

V2 hooks intercept live operations. Register a hook on its domain and dispose the returned registration when it is no longer needed.

```ts
const registration = await ctx.session.hook("context", () => {})
await registration.dispose()
```

Multiple plugins can register the same hook. OpenCode runs them in plugin order, so later hooks see changes made by earlier hooks. [11]

Important rules:

- Hook changes affect outgoing model calls, not persisted history or configuration.
- A hook intended to apply to every request must register for each relevant request kind.
- `options` starts empty for each model call.
- Request overrides take precedence over model defaults, which take precedence over route defaults.
- Permission hooks run for `allow` and `ask` decisions; explicit configured `deny` decisions are final. [11]

## V2 Transforms

Transforms are synchronous edits to OpenCode domain state. Each transform builds on earlier registrations in the same domain.

General pattern:

```ts
const registration = await ctx.<domain>.transform((editor) => {
  // inspect, add, update, remove, or set defaults
})

await ctx.<domain>.reload()
await registration.dispose()
```

Rules:

- Keep transforms cheap and repeatable.
- Load external data before the synchronous callback.
- Call `reload()` when captured external data changes.
- Registry reads reflect every registration made so far.
- Disposing a registration removes that transform and rebuilds from remaining transforms. [11]

## CLI/TUI Plugins

CLI plugins extend the terminal with commands, routes, slots, Markdown renderers, notifications, local state, dialogs, tabs, keymaps, and OpenTUI rendering.

They are separate from server-side plugin behavior. A package can expose both:

```json
{
  "name": "opencode-acme-plugin",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx"
  },
  "dependencies": {
    "@opencode/plugin": "latest"
  },
  "peerDependencies": {
    "@opentui/core": ">=0.6.6",
    "@opentui/solid": ">=0.6.6",
    "solid-js": ">=1.9.0"
  }
}
```

The server entrypoint is `./src/index.ts`; the terminal entrypoint is `./src/tui.tsx`. [16]

### Basic TUI plugin

```tsx
// .opencode/plugins/acme/tui.tsx
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "acme.cli",
  setup(context) {
    context.ui.toast.show({
      message: "CLI plugin loaded",
      variant: "success",
    })
  },
})
```

Import `@opencode/plugin/tui` directly; OpenCode resolves it at runtime. [16]

### TUI context

`setup(context)` receives:

- Configuration and plugin options.
- App metadata and channel.
- Current location.
- OpenCode client.
- Cached data.
- Theme tokens.
- OpenTUI renderer.
- UI APIs. [16]

### TUI event subscription

```ts
const stopPermission = context.data.on("permission.asked", (event) => {
  context.ui.toast.show({ message: `Permission ${event.data.id}` })
})

const stopAll = context.data.listen(({ details }) => {
  console.log(details.type)
})

return () => {
  stopPermission()
  stopAll()
}
```

Use `data.on` for one typed event or `data.listen` for every server event. Both return an unsubscribe function. [16]

### TUI data APIs

Available cached-data domains include:

- Sessions: list, get, root, family, cost, status, sync, invalidate.
- Pending inbox items and messages: list, get, sync, invalidate.
- Permission requests: list, sync, invalidate.
- Forms: list, sync, reply, cancel, invalidate.
- Projects and saved permissions: list, get, sync, invalidate.
- Shells: list, get, sync, invalidate.
- Location state and VCS state: sync, read, invalidate.
- Location-scoped agents, commands, integrations, models, providers, references, skills, and MCP servers/resources: list, sync, invalidate. [16]

### TUI commands and keymaps

```ts
context.keymap.layer(() => ({
  mode: "global",
  priority: 10,
  commands: [
    {
      id: "acme.status",
      title: "Show Acme status",
      group: "Acme",
      bind: "ctrl+g",
      palette: true,
      slash: { name: "acme", aliases: ["status"], arguments: true },
      enabled: () => true,
      suggested: true,
      run: async (input) =>
        context.ui.toast.show({ message: input ?? "Ready" }),
    },
  ],
  bindings: ["acme.status"],
}))
```

Use when: adding keyboard shortcuts, slash commands, palette commands, or temporary input modes. [16]

### TUI dialogs and toasts

```ts
await context.ui.dialog.alert({
  title: "Acme",
  message: "Ready",
})

const confirmed = await context.ui.dialog.confirm({
  title: "Continue?",
  message: "Run the Acme action?",
})

const name = await context.ui.dialog.prompt({
  title: "Name",
  placeholder: "release",
})

const mode = await context.ui.dialog.select({
  title: "Mode",
  current: "safe",
  options: [
    { title: "Safe", value: "safe" },
    { title: "Fast", value: "fast" },
  ],
})

context.ui.toast.show({
  title: "Acme",
  message: "Saved",
  variant: "success",
  duration: 3000,
})
```

Use when: collecting user input, confirming risky actions, or showing non-blocking feedback. [16]

### TUI routes, tabs, slots, and panels

- Routes: register custom JSX routes and navigate among home, session, and plugin pages.
- Tabs: list, open, focus, move, and close session tabs when enabled.
- Slots: insert or replace JSX at supported locations such as `app`, `home.footer`, `prompt.footer`, `sidebar.content`, and `session.panel`.
- Panels: add session-scoped panels opened through commands.

Slot placement options are `prepend`, `append`, `before`, `after`, and `replace`. [16]

### TUI storage

Durable storage persists JSON across restarts and synchronizes across TUI instances:

```ts
const [settings, updateSettings] = context.storage.store("settings", {
  initial: { compact: false },
})
```

Memory storage survives plugin reloads but is discarded when the TUI exits:

```ts
const [state, updateState] = context.storage.memory("state", {
  initial: { count: 0 },
})
```

[16]

## CLI-Only Plugin Configuration

CLI-only plugins run locally in the terminal and remain active when the CLI connects to a remote server. Configure them in `cli.json`:

```json
{
  "plugins": ["opencode-acme-cli"]
}
```

Use `cli.json` only for terminal-only plugins. Server/TUI package plugins configured in `opencode.json(c)` that expose a TUI component are loaded automatically by the CLI. [16][17]

## Implementation Workflow

Follow this order for every plugin request:

1. **Clarify the outcome.** Identify whether the user wants observation, interception, a new tool, configuration changes, authentication, terminal UI, or external integration.
2. **Choose the API generation.** Use V1 event hooks for stable event-based behavior; use V2 domains/transforms for structural extension; use CLI/TUI plugins for terminal UI.
3. **Choose the location.** Use `.opencode/plugins/` for project-specific behavior, `~/.config/opencode/plugins/` for user-global behavior, or an npm/Git package for distribution.
4. **Create the smallest working plugin.** Start with one hook, tool, transform, or UI feature.
5. **Add types.** Prefer TypeScript and the appropriate `@opencode-ai/plugin` or `@opencode/plugin` types.
6. **Handle errors safely.** Fail loudly for invalid configuration, validate external input, and avoid swallowing errors.
7. **Test by restarting or reloading.** Watched config-directory changes reload automatically; otherwise restart OpenCode or run `opencode service restart` when needed. [17]
8. **Document the plugin.** Include its purpose, hooks/APIs used, configuration options, permissions required, and uninstall steps.

## Plugin Template

Use this template for a V1-style project plugin:

```ts
// .opencode/plugins/acme-helper.ts
import type { Plugin } from "@opencode-ai/plugin"

export const AcmeHelper: Plugin = async ({ project, client, $, directory, worktree }) => {
  await client.app.log({
    body: {
      service: "acme-helper",
      level: "info",
      message: "Plugin initialized",
      extra: { directory, worktree },
    },
  })

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await client.app.log({
          body: {
            service: "acme-helper",
            level: "info",
            message: "Session became idle",
          },
        })
      }
    },

    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        // Add guardrails here.
      }
    },

    "tool.execute.after": async (input, output) => {
      // Audit or react to completed tool execution.
    },

    "shell.env": async (input, output) => {
      output.env.AGENT_PROJECT_ROOT = input.cwd
    },
  }
}
```

## V2 Plugin Template

Use this template for a V2-style plugin:

```ts
// .opencode/plugins/acme/index.ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "acme.helper",

  async setup(ctx) {
    const strict = ctx.options.strict === true

    await ctx.storage.set("initializedAt", new Date().toISOString())

    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "acme",
        description: "Acme helper tools",
      })

      editor.add({
        name: "status",
        description: "Report Acme plugin status",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async (_input, context) => {
          await context.progress({ status: "checking" })
          return { content: "Acme plugin is active" }
        },
      })
    })

    const commandRegistration = await ctx.command.transform((editor) => {
      editor.add({
        name: "acme-status",
        description: "Run the Acme status workflow",
        execute: async ({ sessionID }) => {
          await ctx.session.synthetic({
            sessionID,
            text: "Acme status workflow triggered.",
          })
        },
      })
    })

    return () => {
      void toolRegistration.dispose()
      void commandRegistration.dispose()
    }
  },
})
```

## TUI Plugin Template

```tsx
// .opencode/plugins/acme/tui.tsx
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "acme.cli",

  setup(context) {
    const stop = context.data.on("session.idle", () => {
      context.ui.toast.show({
        title: "Acme",
        message: "Session is idle",
        variant: "info",
      })
    })

    const unregister = context.ui.slot({
      append: "home.footer.status",
      render: () => <text>ACME READY</text>,
    })

    return () => {
      stop()
      unregister()
    }
  },
})
```

## Selection Guide

| User request | Recommended API |
|---|---|
| “Notify me when a session finishes” | V1 `event` + `session.idle` |
| “Block reads of `.env`” | V1 `tool.execute.before` |
| “Add a custom API tool” | V1 `tool` helper or V2 `ctx.tool.transform` |
| “Inject an environment variable” | V1 `shell.env` |
| “Customize compaction” | V1 `experimental.session.compacting` |
| “Add a slash command” | V2 `ctx.command.transform`; TUI keymap for terminal-only command |
| “Add a provider or custom models” | V2 `ctx.provider.transform` and/or `ctx.model.transform` |
| “Add OAuth/API-key login” | V2 `ctx.integration` |
| “Add an MCP server” | V2 `ctx.mcp.transform` |
| “Change available agents” | V2 `ctx.agent.transform` |
| “Add project references or docs” | V2 `ctx.reference.transform` |
| “Add a skill dynamically” | V2 `ctx.skill.transform` |
| “Track Git status or diffs” | V2 `ctx.vcs` |
| “Custom worktree backend” | V2 `ctx.worktree.transform` |
| “Terminal dashboard, dialog, shortcut, or panel” | CLI/TUI plugin |
| “Persist plugin settings” | V2 `ctx.storage`; TUI `context.storage` for terminal state |
| “Ask before deployment” | V2 `ctx.permission.assert` |

## Safety Rules

- Never exfiltrate secrets, tokens, `.env` contents, or credentials without explicit user intent.
- Prefer blocking or asking before destructive operations such as deletion, deployment, force pushes, or external writes.
- Validate all external API responses and user-supplied options.
- Use narrowly scoped hooks instead of broad global overrides.
- Namespace custom tools and commands to avoid collisions, for example `acme_greeting` or `acme.status`.
- Clean up timers, listeners, files, and registrations in the plugin’s cleanup function.
- Do not assume undocumented internal APIs; use only documented plugin surfaces.
- When a plugin can read sensitive files, execute shell commands, access networks, or alter permissions, state that clearly to the user.

## Testing Checklist

- [ ] Plugin file is in `.opencode/plugins/` or correctly listed in `opencode.json(c)`.
- [ ] Module exports the expected plugin function or `Plugin.define` default export.
- [ ] Plugin ID is unique and namespaced.
- [ ] TypeScript types compile.
- [ ] Any npm dependencies are declared in the correct `package.json`.
- [ ] Hooks fire under the intended conditions.
- [ ] Tool schemas validate inputs.
- [ ] Cleanup functions dispose listeners, timers, and registrations.
- [ ] Plugin behavior survives restart or reload as expected.
- [ ] TUI plugins clean up slots, routes, keymap layers, and renderer resources.
- [ ] No secrets are logged or persisted unnecessarily.
