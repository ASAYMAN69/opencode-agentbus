import { Plugin } from "@opencode/plugin/tui"
import * as fs from "node:fs"
import { createSignal, onCleanup } from "solid-js"

export default Plugin.define({
  id: "agentbus.tui",
  setup(context: any) {
    const [statuses, setStatuses] = createSignal<any>({})
    const readStatuses = () => {
      try {
        const raw = fs.readFileSync("/home/asayman/.config/opencode/plugins/agentbus/status.json", "utf-8")
        setStatuses(JSON.parse(raw) || {})
      } catch {
        setStatuses({})
      }
    }
    readStatuses()
    const interval = setInterval(readStatuses, 1000)
    onCleanup(() => clearInterval(interval))

    function getBadge(sid: string) {
      if (!sid) return null
      const session = context.data?.session?.get?.(sid)
      const title = session?.title || ""

      let isMain = false
      try {
        const storedHead = context.storage?.get?.("head_session_id")
        if (storedHead === sid) isMain = true
      } catch {}

      const lower = title.toLowerCase()
      if (lower.startsWith("[main]") || lower.includes("main agent") || lower.includes("head")) {
        isMain = true
      }

      if (isMain) {
        return <text bg="red" fg="#d0d0d0" bold> MAIN </text>
      }

      if (title.startsWith("AgentBus:")) {
        const name = title.replace("AgentBus:", "").trim().toUpperCase()
        return <text bg="yellow" fg="black" bold> {name} </text>
      }

      if (lower.includes("frontend")) return <text bg="yellow" fg="black" bold> FRONTEND </text>
      if (lower.includes("backend")) return <text bg="yellow" fg="black" bold> BACKEND </text>
      if (lower.includes("tester")) return <text bg="yellow" fg="black" bold> TESTER </text>
      if (lower.includes("dbmaster")) return <text bg="yellow" fg="black" bold> DBMASTER </text>

      return null
    }

    // 1. Badge directly above prompt box (just below the chat history/title)
    const unregisterComposerSlot = context.ui?.slot?.({
      prepend: "session.composer.top",
      render: () => {
        const currentRoute = context.ui?.router?.current?.()
        const sid = currentRoute?.sessionID
        if (!sid) return null
        const badge = getBadge(sid)
        if (!badge) return null
        return (
          <box paddingBottom={1}>
            {badge}
          </box>
        )
      }
    })

    // 2. Right navbar / sidebar: Show processes and status of each delegated sub-agent
    const unregisterSidebarSlot = context.ui?.slot?.({
      append: "sidebar.content",
      render: ({ sessionID }: { sessionID?: string }) => {
        if (!sessionID) return null
        const session = context.data?.session?.get?.(sessionID)
        const title = session?.title || ""
        const lower = title.toLowerCase()

        // Main agent: show all sub-agent statuses in the sidebar
        const isMain = lower.startsWith("[main]") || lower.includes("main agent") || lower.includes("head")
        if (isMain) {
          const allStatuses = statuses()
          const keys = Object.keys(allStatuses)
          if (keys.length === 0) {
            return (
              <box paddingLeft={1}>
                <text fg="#606060">no sub-agents</text>
              </box>
            )
          }
          return (
            <box paddingLeft={1} flexDirection="column">
              {keys.map((agentKey) => {
                const info = allStatuses[agentKey]
                if (info?.status === "running") {
                  return (
                    <box flexDirection="row">
                      <text fg="yellow" bold>● running: </text>
                      <text fg="#a0a0a0">{agentKey} — {info.task}</text>
                    </box>
                  )
                }
                if (info?.status === "completed") {
                  return (
                    <box flexDirection="row">
                      <text fg="green" bold>✓ done: </text>
                      <text fg="#808080">{agentKey} — {info.task}</text>
                    </box>
                  )
                }
                if (info?.status === "interrupted") {
                  return (
                    <box flexDirection="row">
                      <text fg="red" bold>✗ interrupted: </text>
                      <text fg="#808080">{agentKey} — {info.task}</text>
                    </box>
                  )
                }
                return (
                  <box>
                    <text fg="#606060">{agentKey}: idle</text>
                  </box>
                )
              })}
            </box>
          )
        }

        // Check if this sidebar item is a sub-agent
        if (title.startsWith("AgentBus:") || lower.includes("frontend") || lower.includes("backend") || lower.includes("tester") || lower.includes("dbmaster")) {
          let agentKey = ""
          if (title.startsWith("AgentBus:")) {
            agentKey = title.replace("AgentBus:", "").trim().toLowerCase()
          } else {
            const l = title.toLowerCase()
            if (l.includes("frontend")) agentKey = "frontend"
            else if (l.includes("backend")) agentKey = "backend"
            else if (l.includes("tester")) agentKey = "tester"
            else if (l.includes("dbmaster")) agentKey = "dbmaster"
          }

          let statusInfo: any = null
          try {
            const raw = fs.readFileSync("/home/asayman/.config/opencode/plugins/agentbus/status.json", "utf-8")
            const statuses = JSON.parse(raw) || {}
            statusInfo = statuses[agentKey]
          } catch {}

          if (statusInfo?.status === "running") {
            return (
              <box paddingLeft={1} flexDirection="row">
                <text fg="yellow" bold>● running: </text>
                <text fg="#a0a0a0">{statusInfo.task}</text>
              </box>
            )
          }

          if (statusInfo?.status === "completed") {
            return (
              <box paddingLeft={1} flexDirection="row">
                <text fg="green" bold>✓ done: </text>
                <text fg="#808080">{statusInfo.task}</text>
              </box>
            )
          }

          if (statusInfo?.status === "interrupted") {
            return (
              <box paddingLeft={1} flexDirection="row">
                <text fg="red" bold>✗ interrupted: </text>
                <text fg="#808080">{statusInfo.task}</text>
              </box>
            )
          }

          return (
            <box paddingLeft={1}>
              <text fg="#606060">idle</text>
            </box>
          )
        }

        return null
      }
    })

    return () => {
      unregisterComposerSlot?.()
      unregisterSidebarSlot?.()
    }
  }
})
