---
name: code-review
metadata:
  display-name.en: "Code review"
  display-name.zh-CN: "代码审查"
  display-name.zh-TW: "程式碼審查"
  display-name.ja: "コードレビュー"
  display-name.ko: "코드 검토"
  display-name.fr: "Revue de code"
  display-name.de: "Codeprüfung"
  display-name.es: "Revisión de código"
  display-name.pt-BR: "Revisão de código"
  display-name.ru: "Проверка кода"
  display-name: Code review
description: Review local changes, commits or GitHub pull requests for concrete regressions and scoped repository-rule violations. Use for requested code review, not implementation or a standalone security audit.
---

# Code review

Review the requested change and report concrete, actionable regressions. A review request authorizes inspection and analysis only; do not modify files, commit, approve, merge, or publish external comments unless explicitly requested.

## Scope and rules

1. Establish the exact review target and use available read-only evidence for that target:
   - For local changes, use `git_status` for the inventory and `git_diff` for each tracked file in the requested staged, unstaged, or combined scope, when those tools are available. Read requested untracked files with a file reader.
   - For a commit or `base..head` range, use a diff source that supports the exact commit or both endpoints. Worktree status and diffs do not establish commit or range coverage.
   - For a pull request, read its description, existing review threads, checks, and exact base/head SHAs. Use available GitHub reads or other evidence for those revisions.
   - Use read-only Git commands only when a shell is available and authorized. A supplied patch for the requested scope can also be reviewed. If the exact diff cannot be obtained, ask for it or state what cannot be reviewed; do not substitute a different scope.
2. Read `rules/index.md` via `read_skill_resource` for `code-review:code-review`, map the changed file paths to rule files, and load each applicable `rules/<name>.md` once. Also apply repository instructions (such as `AGENTS.md`) scoped to the changed paths.
3. Inspect diffs and use available read-only file and search tools for surrounding context, in parallel batches when independent. Check relevant unchanged callers, interfaces, and tests when verifying a suspected bug. Note generated, binary, oversized, or inaccessible files that were skipped.

## Review and delegation

Keep small or cohesive reviews in a single reviewer. For large multi-area changes, optionally delegate disjoint file groups with `spawn_agent` using clear file lists, diff ranges, and applicable rule paths. Verify delegated findings against the actual code before reporting.

Prioritize demonstrated correctness bugs, security issues, data loss, concurrency/resource leaks, and scoped repository-rule violations:
- Verify the trigger, consequence, and exact changed-line location (`path:line`).
- Check for existing guards, upstream checks, or contrary evidence before reporting.
- Combine multiple symptoms that share one root cause.
- Exclude unrelated pre-existing issues, speculation, style preferences, and generic requests for more tests.
- Run a focused existing check only if authorized and needed to resolve uncertainty.

## Severity and report

- `P0`: data loss, security vulnerability, certain crash, or corruption.
- `P1`: likely incorrect behavior during normal use.
- `P2`: defect limited to edge cases or specific inputs.
- `P3`: minor concrete defect.

List findings first, ordered by severity, with exact `path:line`, concise title, trigger, consequence, and concrete evidence. Follow with a brief summary of the reviewed scope (commit/range or worktree), coverage, meaningful skips, and checks actually run. If coverage is partial, state the gaps clearly. For authorized external publication, recheck the current head SHA and existing review threads before posting, and inspect the remote state before retrying an uncertain write.
