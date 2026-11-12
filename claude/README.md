# Claude Code

An optional Sailry model provider package. It uses the Claude Code `claude`
that is installed and signed in on the execution Node as a per-step model:
Sailry keeps its own loop, tools, approvals, history and compaction.

The package is a declaration. It names the `claude` executable, the models the
channel offers and the sign-in instruction. It contains no script and declares
no argument: the Node owns the command line. The Node starts `claude` on
demand, keeps one process per conversation, stops it when idle, and kills it
when the package is disabled or removed.

- The binary is the user's own and is not modified. Nothing is loaded into it,
  no request is rewritten, and no header, version or billing mark is forged.
- `claude` uses its own sign-in. Sailry holds no Claude token and reads no
  credential file or keychain item. Sign in by running `claude` yourself.
- Claude Code's built-in tools are off. Sailry's tools reach the process as
  MCP tools through a relay only the same OS user can connect to, so approvals
  and results stay in Sailry.
- The user's Claude Code settings, hooks, MCP servers, skills, memory and
  CLAUDE.md are not loaded. The process works in the package's own program
  directory, never in a project.
- Models are `--model` aliases, so each follows the model Claude Code maps it
  to. Their context sizes are not declared here because an alias has none of
  its own.
- A missing executable, a signed-out Claude Code and a refusal by Anthropic are
  errors of the turn, never reply text.

Using a subscription through a client other than the vendor's own may be against
the vendor's terms and may lead to limits on the account. Anthropic may meter
this use differently from interactive use or refuse it. That choice and its risk
are the user's.

Synthetic fixtures in the application repository cover the route. They do not
prove live account access. The design reference is in NOTICE.
