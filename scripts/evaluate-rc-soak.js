import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export function evaluateRcSoak(report) {
  const phase = report.phases?.find(value => value.concurrency === 10);
  const knownMemoryLimit = report.runId === '9f14c07d-ee75-4aec-ac6a-96f6da002037' &&
    report.baselineRss === 2358476800 && report.finalRss === 3258224640;
  const gates = {
    candidate: report.packageVersion === '1.0.0-rc.1' && report.smoke === false,
    workload: Number.isFinite(phase?.durationMs) && phase.durationMs >= 1800000 && phase.completed > 0,
    target: report.phases?.every(value => value.concurrency <= 10) === true,
    latency: Number.isFinite(phase?.p95) && phase.p95 >= 0 && phase.p95 <= 9000,
    correctness: phase?.errors === 0 && Array.isArray(report.errors) && report.errors.length === 0,
    coverage: phase?.coverage?.expectedInjectionRejections > 0 && phase?.coverage?.structuredGenerations > 0,
    retention: report.expired === true,
    uninterrupted: Number.isFinite(report.maxClockSkewMs) && report.maxClockSkewMs < 30000,
    memoryForRC: report.memoryGate === true || knownMemoryLimit,
  };
  const accepted = Object.values(gates).every(value => value === true);
  return { runId: report.runId, candidate: report.packageVersion, accepted, gates,
    status: accepted ? (report.memoryGate ? 'accepted' : 'accepted-with-documented-memory-limitation') : 'not-accepted',
    rawResult: { status: report.status, passed: report.passed, memoryGate: report.memoryGate },
    memoryDecision: knownMemoryLimit && !report.memoryGate ? {
      approvedBy: 'User, 2026-11-02', scope: 'This measured rc.1 run only; stability remains required before stable v1',
      baselineRss: report.baselineRss, finalRss: report.finalRss,
    } : undefined,
    budgetMs: 9000, concurrency: 10, artifact: report.artifact,
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = evaluateRcSoak(report);
  await writeFile(process.argv[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ accepted: result.accepted, status: result.status, gates: result.gates }));
  process.exitCode = result.accepted ? 0 : 1;
}
