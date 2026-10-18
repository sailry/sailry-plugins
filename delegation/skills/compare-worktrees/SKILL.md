---
name: compare-worktrees
description: Implement two or more competing approaches with independent subagents in separate registered worktrees, compare their changes and verification, and recommend a result.
metadata:
  display-name: Compare approaches
---

# Compare approaches

Use this skill when the user requests two or more competing implementations or experiments in independent worktrees, followed by comparison or a recommendation. Compose available worktree, delegation, Git and test tools; do not introduce another execution engine or invent unavailable capabilities. If the request is only a question, compare the approaches directly without creating worktrees.

## Establish one baseline

Read applicable repository instructions, list registered worktrees, and inspect the current worktree's head, index revision and dirty changes. Resolve the task, acceptance criteria, competing approaches and shared constraints. Use two approaches by default when the user requests alternatives without a count; keep the number small enough to verify each result. Record the same immutable starting commit and whether existing changes are part of the requested baseline. Preserve unrelated edits.

Create a distinct registered worktree and branch for every implementation using create_worktree's captured head/index checks. include_changes is false unless the requested baseline explicitly includes current edits. Existing unregistered worktrees must be registered before delegation. Do not use arbitrary paths as spawn_agent worktree IDs or move the parent session's directory.

## Delegate independently

Give each child a self-contained task with its approach, baseline, worktree ID, exact scope, constraints, acceptance criteria and expected output. Select only a role actually listed by spawn_agent, or omit it. Children do not see the parent conversation. Tell them to preserve unrelated changes, implement only their approach, report exact changed paths and verification, and leave their result available for comparison. Sharing a worktree requires disjoint files; separate worktrees provide isolation for overlapping implementations.

Run independent children concurrently when supported. A requested comparison or recommendation requires collecting every final result with wait_agent before presenting the comparison. If the user requests background execution instead, acknowledge admission and leave the children running; do not wait until the user explicitly requests waiting or result collection. Apply user steering to the original objective and guide affected children. Guidance alone does not request foreground waiting: acknowledge its queued receipt without claiming the child has finished. A failed or cancelled alternative remains an observed outcome, not evidence that another alternative passed.

Coordinate build ownership before verification. Each worktree needs its own target/output directory, with dependency and platform flags held constant. Do not run competing Cargo processes in one target directory or delete another child's artifacts to resolve a lock. Exercise the same relevant acceptance criteria and local/remote boundaries for every alternative; distinguish actual tests from reasoning or narrower fixtures.

## Compare evidence

Inspect each registered worktree's Git status, frozen change inventory and relevant patches rather than relying only on a child's summary. Verify that changes derive from the same baseline and meet scope. Follow pagination and report any inaccessible or skipped files. Summarize each alternative's behavior, affected paths, implementation tradeoffs, actual verification and unresolved failures in a compact table. Do not rank solely by line count, speed claims or agreement between children.

Recommend one approach from that evidence and explain its material tradeoff. Leave integration to the user's selection unless they already authorized choosing the best result. A selected result must still pass its acceptance criteria before integration. Never merge every experiment into the main checkout, force-reset unrelated changes, or silently discard the other alternatives.

## Clean up

After each child finishes, inspect its worktree with Git tools and its worktree ID. Remove a worktree that has no changes and no new commits. For a worktree with changes, integrate only a selected result with an unrestricted git merge or cherry-pick command when integration is authorized; stop and report conflicts to the user without resolving them automatically. Remove that worktree after its result is integrated or the user discards it. Retain worktrees with unintegrated changes, and never discard work to make removal succeed. Removal keeps the branch and the child's session history; keep the branch unless branch deletion was explicitly authorized. Report retained paths and actual resulting commits without creating unsolicited report files.
