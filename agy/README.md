# Antigravity

An optional Sailry model provider package. It uses the Google Antigravity CLI
`agy` that is installed and signed in on the execution Node as a plain language
model: Sailry keeps its own loop, tools, history and compaction.

The package is a declaration. It names the `agy` executable, its arguments, two
files written into the package's own program directory, and how the Node's Agent
Client Protocol route talks to it. It contains no script. The Node starts
`agy acp` on demand, stops it when idle, and kills it when the package is
disabled or removed.

- The program directory holds a project agent (`.agents/agents/sailry-model`)
  with no tools, skills, rules, plugins or inherited MCP servers, and a hook
  that denies every built-in tool. The Node also refuses every permission
  request, offers no file or terminal capability and passes no MCP server.
- `agy` uses its own profile and keyring. The package does not read, copy or
  move credentials, does not set `--gemini-dir` or `SSH_CONNECTION`, and does
  not redirect `agy`'s traffic. Sign in by running `agy` yourself.
- Models are the ones `agy` lists. When the list cannot be read the provider
  says so; no model is invented. `-low`, `-medium`, `-high` and `-xhigh` variants of one
  model appear as its effort levels.
- Tool calls travel as text, because `agy` has no function-call channel a client
  can fill. A malformed call is a model error, never assistant text.
- Each Sailry conversation keeps one `agy` session, which receives only new
  messages. After `agy` stops or restarts, the Node resumes that session with
  `session/resume` or `session/load`.
- Compaction starts at the model's window and the compaction setting, as on
  other routes. Where the session advertises `/compact`, Sailry records its
  own handoff and then sends `/compact` into the same session.
- `replay_bytes` (112 KiB) bounds only a prompt that replays the whole history
  into a new session: when resuming fails or earlier history changed. A larger
  replay is a context overflow that compaction recovers; nothing is silently
  truncated. The value has not been measured against `agy`. A live test that
  replays growing synthetic histories into new sessions until `agy` rejects
  one would establish it.

Using a subscription through a client other than the vendor's own may be against
the vendor's terms and may lead to limits on the account. That choice and its
risk are the user's.

Synthetic fixtures in the application repository cover the protocol route.
They do not prove live account access. The design references are in NOTICE.
