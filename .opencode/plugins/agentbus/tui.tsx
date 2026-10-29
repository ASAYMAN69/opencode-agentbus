import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "agentbus.tui",
  setup(context: any) {
    function getSessionRole(sid: string): { type: "main" | "sub" | "none"; label?: string } {
      if (!sid) return { type: "none" }
      const session = context.data?.session?.get?.(sid)
      const title = session?.title || ""

      try {
        const storedHead = context.storage?.get?.("head_session_id")
        if (storedHead === sid) return { type: "main", label: "MAIN" }
      } catch {}

      const lower = title.toLowerCase()
      if (lower.includes("head") || lower.includes("main agent") || lower.startsWith("main")) {
        return { type: "main", label: "MAIN" }
      }

      if (title.startsWith("AgentBus:")) {
        const name = title.replace("AgentBus:", "").trim().toUpperCase()
        return { type: "sub", label: name }
      }

      if (lower.includes("frontend")) return { type: "sub", label: "FRONTEND" }
      if (lower.includes("backend")) return { type: "sub", label: "BACKEND" }
      if (lower.includes("tester")) return { type: "sub", label: "TESTER" }
      if (lower.includes("dbmaster")) return { type: "sub", label: "DBMASTER" }

      return { type: "none" }
    }

    const unregisterComposerSlot = context.ui?.slot?.({
      prepend: "session.composer.top",
      render: ({ sessionID }: { sessionID?: string }) => {
        const sid = sessionID || context.ui?.router?.current?.()?.sessionID
        if (!sid) return null

        const role = getSessionRole(sid)
        if (role.type === "main") {
          return (
            <box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0} marginBottom={1}>
              <text bg="red" fg="#d0d0d0" bold> MAIN </text>
            </box>
          )
        }

        if (role.type === "sub") {
          return (
            <box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0} marginBottom={1}>
              <text bg="yellow" fg="black" bold> {role.label} </text>
            </box>
          )
        }

        return null
      }
    })

    const unregisterSidebarSlot = context.ui?.slot?.({
      append: "sidebar.content",
      render: ({ sessionID }: { sessionID?: string }) => {
        if (!sessionID) return null
        const role = getSessionRole(sessionID)

        if (role.type === "main") {
          return (
            <box paddingLeft={1}>
              <text bg="red" fg="#d0d0d0" bold> MAIN </text>
            </box>
          )
        }

        if (role.type === "sub") {
          return (
            <box paddingLeft={1}>
              <text bg="yellow" fg="black" bold> {role.label} </text>
            </box>
          )
        }

        return null
      }
    })

    const unregisterFooterSlot = context.ui?.slot?.({
      append: "prompt.footer.status",
      render: ({ sessionID }: { sessionID?: string }) => {
        const sid = sessionID || context.ui?.router?.current?.()?.sessionID
        if (!sid) return null
        const role = getSessionRole(sid)

        if (role.type === "main") {
          return <text bg="red" fg="#d0d0d0" bold> MAIN </text>
        }
        if (role.type === "sub") {
          return <text bg="yellow" fg="black" bold> {role.label} </text>
        }
        return null
      }
    })

    return () => {
      unregisterComposerSlot?.()
      unregisterSidebarSlot?.()
      unregisterFooterSlot?.()
    }
  }
})
