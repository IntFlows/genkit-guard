# Independent app validation

The sibling `../genkit-guard-test-app` is a separate consumer with its own dependencies and cached real models. Run `npm run test:independent` in this repository, or `npm run refresh:guard` followed by `npm test` in that app. The repository command is opt-in and requires that local app; it is not part of the portable deterministic CI suite.

Refresh builds and installs the npm tarball into the app, replacing source links. Tests exercise actual MiniLM and privacy-filter inference plus Redis. A controlled Genkit model captures immutable snapshots of every provider-boundary request; it does not call a paid provider. The suite covers legacy/native middleware, tool input restoration, masked tool-result history, restored final output, reused-history masking, preserved thought signatures, injection blocking, and TTL assignment.

The application result history can contain restored PII. `response.messages` after generation is not evidence of what was sent to the provider. Only requests observed at the model boundary, snapshotted before response mutation, support that claim.

Results are written to the app's `test-results/integration.json`. Record exact installed artifact, versions and metrics when accepting a release. A successful smoke test does not close long-running soak, live-provider compatibility, detection recall, remote CI or dependency-review gates.
