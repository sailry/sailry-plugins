# Agent tools

Tools are declared in `extensions.dev.sailry.platform.tools`. Sailry gives each tool a stable package namespace, and the Node owns approval, Plan-mode restrictions, cancellation and the recorded outcome. Tool names are lowercase `snake_case` and unique within the package.

Common fields:

| Field | Purpose |
| --- | --- |
| `name` | Tool name |
| `description` | Model-facing explanation: what it does, when to use it, and what it does not do |
| `contexts` | Where it is offered: `plugin`, `workspace`, `database`, `ssh`. Omit for every context |
| `presentation` | `summary`, `details` (default), `progress` or `content` |
| `display` | Localized label and icon in the conversation: `{"label": "Save note", "locales": {...}, "icon": "reicon:files/file-text"}` |

Provide exactly one implementation: `operation`, `handler` or `server`.

## Host operations (no code)

Bind a native operation. The host supplies its parameters and validation.

```json
"actions": ["storage.read", "storage.write"],
"tools": [
  {"name": "read_note", "operation": "storage.get", "description": "Read a saved note by key"},
  {"name": "save_note", "operation": "storage.set", "description": "Save a note; pass the revision from the last read"}
]
```

| Operation | Parameters | Action |
| --- | --- | --- |
| `progress.update` | `title`, `steps[{description, state}]` | None |
| `storage.get` | `key` | `storage.read` |
| `storage.list` | `prefix`, `after`, `limit` | `storage.read` |
| `storage.set` | `key`, `value`, `expected_revision` | `storage.write` |
| `storage.delete` | `key`, `expected_revision` | `storage.write` |
| `settings.read` | None | None |
| `http.request` | `method`, `url`, `headers`, `body`, `credential`, `timeout_ms` | `http.request` |

Progress states are `pending`, `in_progress`, `completed` and `skipped`; use `"presentation": "progress"`. Storage revisions come from the previous read, and `"0"` creates a new key. Writes follow the turn's approval policy and are unavailable in Plan mode.

Storage limits: keys up to 128 bytes, JSON values up to 256 KiB, 256 live keys and 8 MiB per package on each Node. Storage is ordinary data, not a secret store.

HTTP runs on the Node: UTF-8 bodies up to 1 MiB, timeout 1–60000 ms (default 30000), no redirects or retries. `credential` names a settings field marked `x-sailry-secret`; the Node injects it only for that field's origin.

## Script tools (handler)

Write the logic as a named export in the package's headless entry (see `host.md`). Declare JSON Schema `parameters` for the model, and validate the arguments again in the export, as the official plugins do.

```json
"tools": [{
  "name": "word_count",
  "description": "Count words in the given text",
  "handler": {
    "name": "count",
    "read_only": true,
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": ["text"],
      "properties": {"text": {"type": "string", "maxLength": 65536}}
    }
  }
}],
"host": {
  "entry": "dev.sailry.platform/host/main.js",
  "resources": ["dev.sailry.platform/host/main.js"],
  "handlers": ["count"]
}
```

```js
export function count(args) {
  if (typeof args?.text !== "string") throw new Error("text must be a string");
  const text = args.text.trim();
  return {words: text ? text.split(/\s+/).length : 0};
}
```

- Every handler name must appear in `host.handlers`.
- Return JSON. Throw an `Error` (or return `{isError: true, error: {code, message}}`) for a failure the model should see.
- Mark side-effect-free tools `read_only: true`. The Node still enforces Plan-mode restrictions.
- To wrap a native operation, add `"operation": "files.read"` (or another operation) to the handler: the export receives the tool arguments and returns the operation's arguments; the Node runs the operation. An optional `"result": "result"` export receives `{output}` and returns what the model sees, for example `output.isError ? output : output.data`.
- Operations available this way include `files.list`, `files.read`, `files.write`, `files.edit`, `files.search`, `files.find`, `git.status`, `git.diff`, `git.log`, `git.show`, `git.blame`, `git.changes`, `git.change`, `worktrees.list`, `code.diagnostics`, `code.definition`, `code.references`, `code.hover`, `code.symbols`, `process.run` and `http.request`, plus the storage operations above. Declare the matching action, and copy each operation's argument shape from the official plugin that wraps it (Files, Git, Worktrees, Code, Commands).

`files.read` returns a line page: `offset` is zero-based (default 0), `limit` defaults to 200 (maximum 2000), and results include one-based line numbers, the full file revision and `next_offset`. Files may be up to 64 MiB, but each page is bounded to 128 KiB. A page is partial evidence; preserve the exact returned text and line endings when preparing `files.edit`, which requires one unique, nonempty `old_text` and the full `expected_revision`. `files.edit` requires `files.write`; `files.find` matches worktree-relative filename globs and requires `files.read`. `git.show` and `git.blame` read committed content and authorship with `git.read`.

The callback SDK's `readFile(path)` remains a whole-file preview, limited to 128 KiB; it does not accept line pagination. Use the native `files.read` operation for paged reads and large-file editing workflows.

## MCP servers

Ship or launch an MCP server with `mcp.json` at the package root. Every tool the server lists becomes available; add a `tools` entry with `server` only to set presentation or display for a specific MCP tool.

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "reports": {
      "type": "stdio",
      "command": "python3",
      "args": ["-u", "${PLUGIN_ROOT}/server.py"],
      "cwd": "${PLUGIN_DATA}"
    }
  }
}
```

```json
"tools": [{"name": "report", "server": "reports", "presentation": "content"}]
```

A remote server uses `{"type": "streamable-http", "url": "https://example.com/mcp"}` instead of a command.

`${PLUGIN_ROOT}` is the installed package directory and `${PLUGIN_DATA}` is the package's writable data directory. The command runs on the execution Node, so its interpreter and dependencies must exist there; Sailry does not bundle them. State the requirement in the package README or skill.

## Rich results

With `"presentation": "content"`, a tool can return `sailry_content` (or MCP `structuredContent` containing it). Sailry renders the blocks with native tables, diffs and images:

```json
{"sailry_content": {"version": 1, "blocks": [
  {"kind": "table", "columns": ["File", "State"], "rows": [["notes.md", "Updated"]]},
  {"kind": "diff", "path": "notes.md", "text": "@@ -1 +1 @@\n-before\n+after\n"}
]}}
```

Limits: 1–16 blocks and 256 KiB; tables up to 64 columns and 1000 rows, with equal row widths; diffs up to 4096 lines. Add `"truncated": true` to a table or diff that shows partial output. Invalid content falls back to plain output.

Language package tools may bind `code.packages` with `code.read`, or `code.install` and
`code.uninstall` with `code.manage`. Use direct operation declarations as in the Code
plugin. Lifecycle calls require their exact conversation approval and do not grant
installation authority to callbacks. Installation takes the complete returned registry
descriptor; removal takes the installed package and version and affects the entire Node.
