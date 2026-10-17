# Sailry plugins

Official Sailry plugin packages and installable SDK examples. The application,
Node runtime and [SDK contract](https://github.com/sailry/sailry-harness/blob/main/sdk/plugins.md)
live in [sailry-harness](https://github.com/sailry/sailry-harness).

Each top-level package is an ordinary Agent Plugins package with Sailry's v1
extension manifest. `examples/` contains optional developer examples. Package
sources are maintained here only; the application pins this repository as a Git
submodule and embeds its reviewed package snapshot for offline installation.
Startup adds missing default packages and refreshes newer bundled versions,
preserving configuration and enable choices. It does not reinstall packages
removed by the user.

## Versions and immutable packages

New packages start at `0.1.0`. Increase the semantic version when package content
changes; ordinary updates increment the patch version, such as `0.1.0` to
`0.1.1`. Update detection requires strictly newer SemVer precedence. Same-version
content changes, build metadata alone and older versions do not offer an update.
This package policy does not declare a product release: Sailry's extension API
remains `v1`, and numeric format versions remain `1`.
Immutable content digests still verify installed contents and preserve captured
resources and sent-turn references. Updates apply to new admission; historical
captures keep their recorded package. Standalone imported skills retain their
repository-commit update identity rather than adopting plugin release versions.

## Working with the application submodule

This repository has its own Git history. The application's `plugins/` directory
is a Git submodule that records a reviewed commit, not a symbolic link. Clone the
application with its pinned submodules:

```sh
git clone --recurse-submodules https://github.com/sailry/sailry-harness.git
```

For an existing application checkout, run this from its root after pulling parent
changes, preserving any local work first:

```sh
git submodule update --init --recursive
```

A submodule checkout commonly has a detached HEAD. Before committing plugin
changes, select an existing owned branch or create one from the pinned commit:

```sh
git -C plugins status --short
git -C plugins switch -c feature/plugin-change
```

Commit plugin changes inside this repository, then commit the updated `plugins/`
pointer separately in the application repository. A parent commit or ordinary
push does not commit or publish plugin files. When publication is requested,
push the plugin commit first, then push the parent commit that references it.
This keeps the recorded plugin snapshot available to recursive checkouts.

After both repositories have their changes committed on branches, Git can push
required plugin commits before the parent in one command:

```sh
git push --recurse-submodules=on-demand
```

This does not commit pending file changes. Repository-local
`push.recurseSubmodules=on-demand` can make it the default for future pushes.

## Checks and catalog

Use Python 3.12 or newer and Node.js 22.22.1:

```sh
python3 -m unittest discover -s scripts/tests -v
python3 scripts/check-names.py
node --experimental-vm-modules scripts/check-packages.mjs
python3 scripts/test.py
python3 scripts/catalog.py --check
```

CI also checks workflow syntax. Package checks cover all official packages and
examples, v1 contracts, declared assets, static imports and JavaScript syntax
without executing plugin initialization. Behavior tests include controllers,
host handlers, games and localized UI contracts; real Node integration remains
in the application repository.

For production QuickJS and SDK contract cases, select a prebuilt application
test host explicitly:

```sh
python3 scripts/test.py --runtime-host /path/to/plugin-test-host
```

Package tests import `scripts/test-host.mjs` and own their inputs and assertions.
The helper loads declared host modules and supplies explicit typed service
replies; it does not start a Node, access a profile, or prove UI or transport
behavior. Without `--runtime-host`, these cases are reported as skipped rather
than falling back to a mock. Ordinary package tests keep using the same runner.

Keep function and test names concise. Files, modules and classes supply context;
do not repeat their names as prefixes or add groups just to shorten labels.
The shared naming check allows seven semantic words in identifiers and twelve
in test labels, excluding required Python `test_` prefixes and generated source.

CI regenerates `catalog.json` from package manifests and publishes changes after
successful checks on `main`. Run `python3 scripts/catalog.py` to review index
changes locally. The marketplace and update checks read the same versions and
descriptions from this index. Check the regenerated index with
`python3 scripts/catalog.py --check`. Explicit installations and updates resolve
a package path to an immutable Git commit through the execution Node; clients do
not execute Git or receive credentials.

## License and provenance

Sailry-owned sources use [Apache-2.0](LICENSE). Package-local notices and licenses
remain authoritative for imported resources. Sources were extracted from the
reviewed sailry-harness commit `609c544`; original package provenance and notices
are preserved. No profiles, credentials or private development history are part
of this repository.
