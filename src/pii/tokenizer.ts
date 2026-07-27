import { defaultPiiVaultStorage, type PiiVaultStorage } from './storage.js';

export type PiiResult = {
  maskedText: string;
  pii: Record<string, string>;
  piiTypes: string[];
};

export type PiiTokenizerOptions = {
  scopeId?: string;
  storage?: PiiVaultStorage;
};

export class PiiTokenizer {
  private valueToToken = new Map<string, string>();
  private counter = 0;
  private piiTypes = new Set<string>();
  private scopeId: string;
  private tokenNamespace: string;
  private storage: PiiVaultStorage;

  constructor(options: PiiTokenizerOptions = {}) {
    this.scopeId = options.scopeId ?? createVaultScopeId();
    this.tokenNamespace = createVaultScopeId();
    this.storage = options.storage ?? defaultPiiVaultStorage;
  }

  private createToken(type: string) {
    return `[[${type}_${this.tokenNamespace}_${this.counter++}]]`;
  }

  async mask(text: string, matches: { type: string; value: string }[]): Promise<PiiResult> {
    let masked = text;

    for (const match of matches) {
      if (!masked.includes(match.value)) {
        continue;
      }

      const key = `${match.type}:${match.value}`;
      let token = this.valueToToken.get(key);

      if (!token) {
        token = this.createToken(match.type);
        this.valueToToken.set(key, token);
        await this.storage.set(this.scopeId, token, match.value);
      }

      this.piiTypes.add(match.type.toLowerCase());

      masked = masked.split(match.value).join(token);
    }

    return {
      maskedText: masked,
      pii: await this.getVault(),
      piiTypes: Array.from(this.piiTypes)
    };
  }

  async unmask(text: string): Promise<string> {
    let result = text;
    const entries = await this.storage.entries(this.scopeId);

    for (const { token, value } of entries) {
      result = result.split(token).join(value);
    }

    return result;
  }

  async importTokens(text: string) {
    if (!this.storage.getByToken) {
      return;
    }

    const tokenMatches = Array.from(text.matchAll(/\[\[[A-Z_]+_[A-Za-z0-9]+_\d+\]\]/g));

    for (const [token] of tokenMatches) {
      const value = await this.storage.getByToken(token);
      if (value) {
        await this.storage.set(this.scopeId, token, value);
      }
    }
  }

  async getVault() {
    const entries = await this.storage.entries(this.scopeId);
    return Object.fromEntries(entries.map(({ token, value }) => [token, value]));
  }
}

function createVaultScopeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
