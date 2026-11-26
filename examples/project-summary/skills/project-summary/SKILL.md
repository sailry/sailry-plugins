---
name: project-summary
description: Inspect project changes and explain their current state
---

Use the read-only tools available for the requested scope. For worktree changes,
use `git_status` for the inventory and `git_diff` for tracked files when available.
Read untracked files only when needed and available. For commits or ranges, use
diff evidence tied to the requested revisions. A patch supplied by the user can
also be summarized. Use read-only Git commands only if a shell is available and
authorized. If evidence is missing, say which changes could not be verified;
file contents and partial diffs do not prove that a worktree is clean.
Do not write a report unless the user asks for one. The optional desktop view is not
required to use this skill or to continue the conversation from another controller.
