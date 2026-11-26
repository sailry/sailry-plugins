# Sailry plugin rules

- Start with `git status --short` and `git log --oneline -5`; preserve unrelated
  edits. Read [README.md](README.md) and the affected package before changing it.
- Official plugin source belongs in this independent `sailry-plugins` repository.
  Harness and Code build independently. Install official packages from the catalog
  or a local source.
- Plugins own their UI, state, workflows and tool orchestration. Reuse the public
  [SDK contract](https://github.com/sailry/sailry-harness/blob/main/sdk/plugins.md);
  shared execution, transport and persistence services remain in the application.
- Start new packages at `0.1.0`. Increase the semantic version for changed package
  content; ordinary updates increment the patch version. Update detection uses
  strictly newer SemVer precedence, not content differences. Same-version changes,
  build metadata alone and older versions do not offer an update. This does not
  declare a product release. The current extension API is `v1`; format and
  capability declarations must match the application contract in use.
- When a package starts using a new host capability, set
  `extensions."dev.sailry.platform".min_sailry_version` to the first application
  version containing it. This includes new `sailry/*` modules or exports,
  extension fields and permissions. Use an exact SemVer, including prerelease
  identifiers when needed. Adding or changing this declaration changes package
  content and requires the usual version bump.
- Immutable content digests verify package contents and identify captures. Preserve captured
  package resources and sent-turn references; updates apply to new admission.
  Never rewrite historical captures to deliver a package fix.
- Regenerate `catalog.json` with `python3 scripts/catalog.py` after manifest
  changes and check it with `python3 scripts/catalog.py --check`. Commit package
  content first, then generate and commit the catalog so version records reference
  existing commits. The committed catalog owns published version-to-commit
  identities; never edit those mappings by hand. New versions must have exactly
  one package tree, use distinct SemVer precedence, and reference their first
  content commit. Build metadata is not a version bump. Correct unpublished
  same-version edits before publication; published fixes require a new version.
  `catalog-withdrawn.json` may withdraw any release, including the latest, while
  retaining its immutable history record and compatibility metadata. Use a
  complete Git checkout for history generation. Run the relevant
  package checks and behavior tests described in the README; report their actual
  scope. Documentation-only changes need diff review, not product builds.
- Keep release notes in `CHANGELOG.md` under `## <manifest version>`; optional
  `CHANGELOG.<locale>.md` sections use the same exact version. Catalog generation
  includes each version's exact section from its immutable package commit.
  Marketplace categories, tints and localized tool or
  skill names belong to package metadata; changing them also requires a patch bump.
- Keep source, comments, diagnostics and documentation in English. Put product
  copy in localization resources; retain imported licenses and provenance.
- Commit owned, verified changes on an owned branch in this repository. Push only
  when requested. Never force-push or discard other work to resolve a mismatch.
