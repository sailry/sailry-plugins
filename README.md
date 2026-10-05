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
python3 scripts/test.py
python3 scripts/catalog.py --check
```

After changing package metadata, regenerate `catalog.json` with
`python3 scripts/catalog.py`. The official marketplace reads this index from
this repository. Installations resolve a package path to an immutable Git commit
through the execution Node; clients do not execute Git or receive credentials.

## License and provenance

Sailry-owned sources use [Apache-2.0](LICENSE). Package-local notices and licenses
remain authoritative for imported resources. Sources were extracted from the
reviewed sailry-harness commit `609c544`; original package provenance and notices
are preserved. No profiles, credentials or private development history are part
of this repository.
