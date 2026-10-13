# Sailry plugin rules

- Start with `git status --short` and `git log --oneline -5`; preserve unrelated
  edits. Read [README.md](README.md) and the affected package before changing it.
- Official plugin source belongs in this independent `sailry-plugins` repository.
  `sailry-harness` pins a commit through its `plugins/` Git submodule and embeds
  those package assets. A submodule is a separate Git repository, not a symbolic
  link or a second source copy.
- Plugins own their UI, state, workflows and tool orchestration. Reuse the public
  [SDK contract](https://github.com/sailry/sailry-harness/blob/main/sdk/plugins.md);
  shared execution, transport and persistence services remain in the application.
- Start new packages at `0.1.0`. Increase the semantic version for changed package
  content; ordinary updates increment the patch version. Update detection uses
  strictly newer SemVer precedence, not content differences. Same-version changes,
  build metadata alone and older versions do not offer an update. This does not
  declare a product release; keep the Sailry extension API at `v1` and numeric
  format versions at `1`.
- Immutable content digests verify package contents and identify captures. Preserve captured
  package resources and sent-turn references; updates apply to new admission.
  Never rewrite historical captures to deliver a package fix.
- Regenerate `catalog.json` with `python3 scripts/catalog.py` after manifest
  changes and check it with `python3 scripts/catalog.py --check`. Run the relevant
  package checks and behavior tests described in the README; report their actual
  scope. Documentation-only changes need diff review, not product builds.
- Keep source, comments, diagnostics and documentation in English. Put product
  copy in localization resources; retain imported licenses and provenance.
- Commit only owned, verified changes here. Commit the updated `plugins/` pointer
  separately in the parent repository. A parent commit or ordinary push does not
  commit or publish files inside this repository.
- Submodule updates can leave a detached HEAD. Preserve local work and create or
  select an owned branch before committing. Clone the parent recursively, or run
  `git submodule update --init --recursive` there to obtain its pinned commits;
  do not replace that pin with an unreviewed remote tip.
- Push only when requested. When publishing both repositories, push the plugin
  commit first, then the parent commit that references it, so recursive checkouts
  can fetch the recorded package snapshot. Never force-push or discard other work
  to resolve a mismatch.
