import path from 'node:path';
function closure(lock, roots) {
  const packages = lock.packages, visited = new Set();
  function resolve(from, name) {
    let directory = from;
    while (true) {
      const candidate = path.posix.join(directory, 'node_modules', name);
      if (packages[candidate]) return candidate;
      if (!directory || directory === '.') return undefined;
      directory = path.posix.dirname(directory);
    }
  }
  function visit(key) {
    if (!key || visited.has(key)) return;
    visited.add(key);
    const pkg = packages[key];
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) visit(resolve(key, name));
  }
  for (const name of roots) visit(resolve('', name));
  return visited;
}
export function evaluateAuditPolicy(lock, audits) {
  const genkit = closure(lock, ['genkit']);
  const library = closure(lock, Object.keys(lock.packages[''].dependencies ?? {}));
  const blocking = [], inheritedGenkit = [];
  for (const [graph, audit] of Object.entries(audits)) {
    for (const [name, finding] of Object.entries(audit.vulnerabilities ?? {})) {
      const nodes = finding.nodes ?? [];
      const record = { graph, name, severity: finding.severity, nodes };
      const accepted = nodes.length > 0 && nodes.every(node => genkit.has(node) && !library.has(node));
      (accepted ? inheritedGenkit : blocking).push(record);
    }
  }
  return { policy: 'Track accepted Genkit-only paths separately; direct/shared library and unclassified findings block',
    acceptedBy: 'User release-policy decision, 2026-11-02', blocking, inheritedGenkit, passed: blocking.length === 0 };
}
