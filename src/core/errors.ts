/** Stable, sanitized failures at guard-owned infrastructure boundaries. */
export class GuardOperationalError extends Error {
  constructor(public readonly code: 'AUDIT_UNAVAILABLE' | 'VAULT_UNAVAILABLE') {
    super(code === 'AUDIT_UNAVAILABLE' ? 'Guard audit delivery failed' : 'Guard PII vault operation failed');
    this.name = 'GuardOperationalError';
  }
}

export async function guardOperation<T>(code: GuardOperationalError['code'], work: () => T | Promise<T>): Promise<T> {
  try { return await work(); }
  catch { throw new GuardOperationalError(code); }
}
