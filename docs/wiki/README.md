# Wiki source

This is the single source folder for the Genkit Guard wiki. Update these pages in place; release history belongs in the release notes, not version-specific wiki folders. The current content describes the prepared v0.2.0 release and the next v1.0.0-rc.1 API-freeze milestone.

- [1.-Home](1.-Home.md)
- [2.-Architecture](2.-Architecture.md)
- [3.-Getting-Started](3.-Getting-Started.md)
- [4.-Intent-Guard](4.-Intent-Guard.md)
- [5.-PII-Guard](5.-PII-Guard.md)
- [6.-Full-Setup-Guide](6.-Full-Setup-Guide.md)
- [7.-Contributing](7.-Contributing.md)
- [8.-Shared-Model-Configuration](8.-Shared-Model-Configuration.md)
- [9.-Tool-Controls-and-Logging](9.-Tool-Controls-and-Logging.md)
- [10.-Decision-Storage-and-Model-Fallback](10.-Decision-Storage-and-Model-Fallback.md)
- [11.-Framework-Compatibility](11.-Framework-Compatibility.md)
- [12.-Security-and-Operational-Errors](12.-Security-and-Operational-Errors.md)

From the repository root, run `npm run wiki:publish` to preview the remote diff. Run `npm run wiki:publish -- --publish` to commit and push. The default source is `docs/wiki`; `--source DIRECTORY` overrides it, and `--repo URL` selects another remote.

GitHub Git authentication and wiki write access must already be configured. The script uses a temporary checkout, copies only numbered Markdown pages, leaves unrelated remote pages intact, and never force-pushes. This README is not published. Renamed or removed remote pages require separate cleanup.
