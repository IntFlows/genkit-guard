# Wiki pages for v0.1.0

Revised from the seven existing GitHub wiki pages, with new configuration and Release 1 pages. Copy these ten numbered Markdown files into the wiki repository when ready to publish.

- [1.-Home](1.-Home.md)
- [2.-Architecture](2.-Architecture.md)
- [3.-Getting-Started](3.-Getting-Started.md)
- [4.-Intent-Guard](4.-Intent-Guard.md)
- [5.-PII-Guard](5.-PII-Guard.md)
- [6.-Full-Setup-Guide](6.-Full-Setup-Guide.md)
- [7.-Contributing](7.-Contributing.md)
- [8.-Shared-Model-Configuration](8.-Shared-Model-Configuration.md)

- [9.-Tool-Controls-and-Logging](9.-Tool-Controls-and-Logging.md)

From the repository root, run `npm run wiki:publish` to preview the remote diff. Run `npm run wiki:publish -- --publish` to commit and push. GitHub Git authentication and wiki write access must already be configured. The script uses a temporary checkout, leaves unrelated pages intact, and never force-pushes. `--source DIRECTORY` selects another documentation folder; `--repo URL` selects another wiki remote.

- [10.-Decision-Storage-and-Model-Fallback](10.-Decision-Storage-and-Model-Fallback.md)
