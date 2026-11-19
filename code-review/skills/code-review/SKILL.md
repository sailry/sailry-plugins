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

Review the requested change and report actionable regressions. An ordinary review authorizes analysis and private review records. Fixes, commits, approvals, merges and external publication require the corresponding request. Scope creation, findings and receipts require Code or Flagship mode. Plan mode can read a published capture or prepare a review plan.

## Capture and read

Start with `review_scope` for the current worktree, or set the target to a commit or base/head range. For a pull request, use the base and head SHAs from its metadata and consider its description and existing discussions. Delegated reviewers reuse their frozen assignment.

Follow the returned capture or inventory cursor until the scope opens and the inventory is complete. Apply repository instructions to the eligible paths. Use the selected rules supplied in `rules` and load any missing `file.rule.path` through `read_skill_resource` for `code-review:code-review`. Read each selected rule once.

Batch the frozen diffs by `group` or `paths` with `read_review_change`. Put independent reads in the same tool batch. Follow the outer `next` for remaining files, and each file's `next` with a single `path` for remaining diff rows. Read full saved source context as needed with `part:"old"` and `part:"new"`. Never use live Git or file reads for captured changes. Relevant unchanged callers or tests may be read under current permissions and cited as live evidence. Respect captured skips and their reasons.

## Review and delegate

Keep a small review with one reviewer. Delegate only when independent groups justify another reviewer, such as groups with substantial diffs or separate areas of expertise. Use `delegate_review` for disjoint whole groups, match the exact role when a roster is offered, and combine independent assignments in one batch. Prefer `record_receipt:true` with a writable, tool-capable role so each child records its findings and group coverage. Read-only roles can gather evidence with `record_receipt:false`; the parent must verify their evidence and attest coverage. Use the rules and diffs supplied in the assignment, and read any pages still missing.

Prioritize demonstrated correctness, security, data loss and scoped repository-rule violations. A removal is reportable when it breaks something still in use. Verify the trigger, consequence and changed-line anchor, check for existing guards or contrary evidence, and combine issues with the same cause. Exclude unrelated old defects, speculation, style preferences and generic requests for tests. Run a focused existing check only if authorized and needed to resolve an uncertainty.

## Record and finish

Send established findings together in `report_finding({review_id,findings:[...]})`. Each needs the exact scoped path and revision, side (`new` for an added line, `old` for a deleted line), one-based changed line, severity, concise title, explanation and concrete evidence. Include a snippet when it helps pinpoint the change. Use the canonical returned line, and correct only failed entries.

- `P0` for data loss, a security flaw or certain crash or corruption.
- `P1` for likely incorrect behavior during normal use.
- `P2` for a defect limited to edge cases.
- `P3` for a minor concrete defect.

Use `review_complete({review_id,reviewed_groups,delivery_token,finalize:true})` to attest the creator's remaining reviewed groups and finish. Use the token with the highest `delivery_sequence` for this review. A child uses `finalize:false` and follows its assignment for inline evidence. When stored receipts already cover the entire scope, the creator can finalize with an empty group list. Complete groups only after reviewing every diff page, even for zero findings. Follow any recovery detail returned by the tool for an interrupted or delegated review. Skip uncovered groups in the receipt and identify them in the report.

List findings first by impact and canonical location, with the trigger and consequence. Give the frozen scope, coverage, meaningful skips and checks actually run. If the review is incomplete, name the gaps. For authorized external publication, recheck the head and existing threads before posting. Inspect the remote outcome before retrying an uncertain post.
