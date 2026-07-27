export type PiiVaultEntry = {
  token: string;
  value: string;
};

export interface PiiVaultStorage {
  get(scopeId: string, token: string): string | undefined | Promise<string | undefined>;
  getByToken?(token: string): string | undefined | Promise<string | undefined>;
  set(scopeId: string, token: string, value: string): void | Promise<void>;
  entries(scopeId: string): PiiVaultEntry[] | Promise<PiiVaultEntry[]>;
}

export class InMemoryPiiVaultStorage implements PiiVaultStorage {
  private scopes = new Map<string, Map<string, string>>();
  private tokenIndex = new Map<string, string>();

  get(scopeId: string, token: string) {
    return this.scopes.get(scopeId)?.get(token);
  }

  getByToken(token: string) {
    return this.tokenIndex.get(token);
  }

  set(scopeId: string, token: string, value: string) {
    this.getScope(scopeId).set(token, value);
    this.tokenIndex.set(token, value);
  }

  entries(scopeId: string): PiiVaultEntry[] {
    return Array.from(this.getScope(scopeId), ([token, value]) => ({ token, value }));
  }

  private getScope(scopeId: string) {
    let scope = this.scopes.get(scopeId);
    if (!scope) {
      scope = new Map<string, string>();
      this.scopes.set(scopeId, scope);
    }
    return scope;
  }
}

export const defaultPiiVaultStorage = new InMemoryPiiVaultStorage();
