---
name: code-review
metadata:
  display-name: Code review
description: Review local changes, commits or GitHub pull requests for concrete regressions and scoped repository-rule violations. Use for requested code review, not implementation or a standalone security audit.
---

# Code review

Produce actionable findings grounded in the captured change. A review request does not authorize fixing files, committing, approving, merging or publishing feedback. These tools store private review records; they are unavailable in Plan mode. Answer questions or prepare a review plan there without claiming a completed structured review.

## Freeze the scope

If `delegate_review` supplied the task, reuse its `review_id`, unchanged snapshot and complete assigned groups. Do not create another scope. A receipt-producing child submits `finalize:false`; an evidence-only child reads the supplied captures and returns evidence without write-backed review tools. The following creation steps belong to the review creator.

Call `review_scope` before reading patches. Omit `target` for all staged, unstaged and untracked changes in the current session worktree. Use `target:{kind:"commit",data:{revision:"..."}}` for a commit or `target:{kind:"range",data:{base:"...",head:"..."}}` for an explicit tree comparison. Commit references resolve once into full immutable SHAs. For a pull request, use its exact base and head SHAs after reading its description and existing threads with available GitHub tools.

The scope exhausts metadata inventory, excludes credential, dependency, generated, lock, minified and build paths before patch reads, and records binary or unsupported files with explicit reasons. Tests remain eligible. It freezes strong file revisions, rules and groups. The optional `limit` bounds only the first returned page, not the complete frozen scope. Follow `review_scope({review_id,offset:next,limit:100})` until `next` is null; each page is partial evidence. Files, groups, skipped paths and retained findings share that paging order. Bounded-scope failures require a smaller authorized target, not silently sampling files or declaring success.

Read repository instructions applicable to the eligible paths. Read `rules/index.md` with `read_skill_resource` using `skill:"code-review:code-review"` and `path:"rules/index.md"`. Each scoped file provides the selected rule resource path and SHA-256, selected in index order with case-insensitive patterns and the documented Objective-C `.m` prefix rule. Load the supplied `rule.path` through the same skill resource tool before reviewing that file. Keep all original rule text and license notices intact.

## Review every group

Read each eligible patch with the Git plugin's `read_git_change` tool. For each `file` in `scope.files`, use this mapping:

```javascript
read_git_change({
  snapshot: scope.snapshot,
  path: file.path,
  expected_metadata_revision: file.metadata_revision,
  expected_revision: file.revision,
  offset: 0
})
```

`scope.snapshot.metadata_revision` identifies the whole inventory, not the selected file. Never use it as `expected_metadata_revision`. Every request, including a retry or continuation, includes the unchanged `scope.snapshot` and `file.path`. Follow every diff page using its `next` offset and the same file revisions. If a patch read fails, check these argument mappings first; missing or incorrectly mapped arguments do not establish a worktree change. Correct the arguments without replacing the captured scope. Actual target or file changes require a fresh review.

Do not fetch whole commit patches or inspect excluded credential bodies to establish coverage. Read relevant surrounding source, callers and existing tests with available read-only tools when a finding needs them; keep those reads within the task and current permissions.

Groups connect directory peers, source/test or source/header counterparts and locale variants. When delegating, call `delegate_review({review_id,groups:[id],record_receipt:true,role})` for complete disjoint groups. Omit `role` for a new child inheriting this authorized Code turn and model; use a named role only when its captured mode and tools fit the assignment. The package reads the authoritative frozen scope and supplies the unchanged snapshot, each file's metadata and strong revision, and selected rules. Do not compose these captures manually or reuse an old child. The creator alone delegates; a complete group that exceeds the task budget requires a smaller authorized review target, not partial coverage.

Select the receipt mode explicitly. `record_receipt:true` rejects Plan turns, read-only roles, tool-disabled role models and unavailable receipt tools before creating a child. It never changes a role or grants tools. A writable child uses `finalize:false`; only the creator finalizes. For a read-only role choose `record_receipt:false` deliberately: the child gathers evidence using the supplied frozen fields without calling write-backed review tools or claiming a receipt. The authorized parent must independently verify every assigned file and submit findings and complete group coverage. Evidence-only output never completes coverage by itself.

Prioritize correctness, security, data loss and scoped instruction violations. Inspect added and modified code and removals that break behavior. Exclude speculation, unrelated old defects, style preferences and generic requests for tests. Combine reports of the same root cause. Agreement and confidence scores do not establish evidence. Run a focused existing check only when it resolves a concrete uncertainty and is authorized; distinguish actual checks from reasoning, and do not modify code or weaken checks to obtain a passing result.

## Record evidence and coverage

Call `report_finding` for each established issue with `review_id`, exact scoped `path` and `revision`, severity `P0`–`P3`, concise title, trigger/consequence explanation and concrete supporting evidence. Include `side:"new"` for added lines or `side:"old"` for deleted lines, a one-based suggested `line`, and a snippet of complete source lines joined by LF (one final LF is allowed). Preserve source whitespace. The snippet must uniquely match the mapped diff on that side and contain a changed line. Context-only, absent or ambiguous snippets fail; a unique match corrects a mistaken suggested line. Use the returned canonical line when citing the finding.

Submit `review_complete` with explicit `reviewed_files:[{path,revision}]`, `reviewed_groups:[id]` and `finalize:false` after fully reviewing complete groups, even if they yielded zero findings. Unknown, duplicate, stale or partial group receipts fail. Already accepted groups must not be resubmitted. Failures include bounded remaining coverage; use scope pages for the full inventory. A failed transaction cannot continue writing; after `revision_conflict`, invoke the tool afresh and reread scope before deciding whether to retry. Actual target or file changes require a fresh review, rather than reusing stale receipts.

The creator uses `finalize:true` only after stored and incoming receipts cover every eligible file and group. If children already submitted all coverage, pass empty receipt arrays. Finalization rechecks the entire frozen metadata inventory and every eligible strong file revision. Skipped credential paths are checked only as metadata. Success proves explicit recorded coverage and revision checks, not that tests ran or that the project is correct or safe.

## Deliver findings

List retained findings first by impact with narrow canonical file/side/line locations, the triggering condition, consequence and evidence. State the captured scope or full commit SHAs, file and group counts, skips with reasons and checks actually run. Say when no actionable issue was established without claiming exhaustive project correctness. Follow the user's requested format.

For explicitly requested external publication, recheck the head revision and existing threads before posting through the available GitHub tools. If the outcome is uncertain, inspect the remote result before retrying. A local review receipt alone does not authorize publication.
