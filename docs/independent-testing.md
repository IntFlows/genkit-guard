# Independent app validation

The sibling `../genkit-guard-test-app` is a separate consumer with its own dependencies and cached real models. Run `npm run test:independent` in this repository, or `npm run refresh:guard` followed by `npm test` in that app. The repository command is opt-in and requires that local app; it is not part of the portable deterministic CI suite.

Refresh builds and installs the npm tarball into the app, replacing source links. Tests exercise actual MiniLM and privacy-filter inference plus Redis. A controlled Genkit model captures immutable snapshots of every provider-boundary request; it does not call a paid provider. The suite covers legacy/native middleware, tool input restoration, masked tool-result history, restored final output, reused-history masking, preserved thought signatures, injection blocking, and TTL assignment. Two RC cases add nested structured-JSON restoration and streaming refusal without provider execution (seven cases total); historical reports with five cases predate those additions.

The application result history can contain restored PII. `response.messages` after generation is not evidence of what was sent to the provider. Only requests observed at the model boundary, snapshotted before response mutation, support that claim.

Results are written to the app's `test-results/integration.json`. Record exact installed artifact, versions and metrics when accepting a release. A successful smoke test does not close long-running soak, live-provider compatibility, detection recall, remote CI or dependency-review gates.

When that app is running a soak, do not refresh its installation. Run `npm run test:independent:isolated` in the library instead: it packs the current library, installs it with exact currently selected Genkit/Redis versions in a temporary consumer, shares only the cached model directory, and executes the app's integration checks. Reports, the installed consumer lockfile and artifact provenance default to `docs/validation/independent-YYYY-MM-DD/`; pass a third CLI argument to select a release evidence directory; the temporary installation is then removed. This is still controlled-provider validation, not live Gemini. See [measurements and deployment limits](./benchmarks.md).


The final rc.1 application report is retained at
[final consumer evidence](./validation/rc-2026-11-02/independent-final.json).
The refresh helper installs a checksum-named archive and verifies its lockfile
integrity against npm pack. This avoids silently reusing a different archive
with the same version. The final benchmark/runtime archive comparison is in
[artifact evidence](./validation/rc-2026-11-02/artifact-comparison.json).
