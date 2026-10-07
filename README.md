# Sailry plugins

Official Sailry plugin packages and installable SDK examples. The application,
Node runtime and [SDK contract](https://github.com/sailry/sailry-harness/blob/main/sdk/plugins.md)
live in [sailry-harness](https://github.com/sailry/sailry-harness).

Each top-level package is an ordinary Agent Plugins package with Sailry's v1
extension manifest. `examples/` contains optional developer examples. Package
sources are maintained here only; the application pins this repository as a Git
submodule and embeds its reviewed package snapshot for offline installation.
New Node profiles install the selected default packages. Restarting does not
reinstall packages removed by the user.

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

Keep function and test names concise. Files, modules and classes supply context;
do not repeat their names as prefixes or add groups just to shorten labels.
The shared naming check allows seven semantic words in identifiers and twelve
in test labels, excluding required Python `test_` prefixes and generated source.

CI regenerates `catalog.json` from package manifests and publishes changes after
successful checks on `main`. Run `python3 scripts/catalog.py` to review index
changes locally. The marketplace and update checks read the same versions and
descriptions from this index. Official package changes require a higher semantic
version to appear as an update. Explicit installations and updates resolve a
package path to an immutable Git commit through the execution Node; clients do
not execute Git or receive credentials.

## License and provenance

Sailry-owned sources use [Apache-2.0](LICENSE). Package-local notices and licenses
remain authoritative for imported resources. Sources were extracted from the
reviewed sailry-harness commit `609c544`; original package provenance and notices
are preserved. No profiles, credentials or private development history are part
of this repository.
