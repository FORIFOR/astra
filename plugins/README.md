# plugins

`builtin/` ships with the core app and cannot be uninstalled (Meeting, Research)
or is pre-listed in the catalog (Gmail, Calendar, Finder).

Each plugin directory carries a `plugin.yaml` conforming to the manifest schema
in `packages/plugin-sdk` (product spec §2.4).

In Phase 0 these manifests exist as **conformance fixtures**: the manifest parser
must accept all five. Nothing is executed until Phase 4.
