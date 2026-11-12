# Cursor

An optional Sailry model provider package. It uses the official Cursor CLI
`agent` that is installed and signed in on the execution Node as a plain
language model: Sailry keeps its own loop, tools, history and compaction.

The package is a declaration. It names the `agent` executable, its arguments,
three files written into the package's own program directory, and how the
Node's Agent Client Protocol route talks to it. It contains no script. The Node
starts `agent acp` on demand, stops it when idle, and kills it when the package
is disabled or removed. Only the documented `agent acp` interface is used; no
private Cursor protocol is spoken and none is ported.

- Every session is put into the CLI's read-only `ask` mode before a prompt. A
  CLI that does not offer that mode is refused.
- The program directory, which is also the session's workspace, holds
  `.cursor/cli.json` (deny rules for shell commands, file reads and writes, web
  fetches and MCP tools), `.cursor/hooks.json` (a hook that denies every tool)
  and `AGENTS.md` (the plain-model rule). The Node also refuses every
  permission request, offers no file or terminal capability and passes no MCP
  server.
- Cursor documents no switch that turns the CLI's built-in tools off. The
  measures above bound them; they are not a guarantee by Cursor.
- `agent` uses its own sign-in. The package reads, copies or moves no
  credential and sets no API key, token or endpoint. Sign in by running
  `agent login` yourself.
- Models are the ones `agent acp` lists for a session. When the list cannot be
  read the provider says so; no model is invented. The model is chosen by the
  CLI's `--model` start option, one process per model.
- Tool calls travel as text, because the CLI has no function-call channel a
  client can fill. A malformed call is a model error, never assistant text.
- A history that the CLI has not seen is replayed in one prompt of at most
  512 KiB. A larger history fails with a context-overflow error; nothing is
  silently truncated.

Requests use your own Cursor subscription and count against its limits.

Synthetic fixtures in the application repository cover the protocol route.
They do not prove live account access.
