export type PiiResult = {
  maskedText: string;
  pii: Record<string, string>;
  piiTypes: string[];
};

export class PiiTokenizer {
  private vault = new Map<string, string>();
  private counter = 0;
  private piiTypes = new Set<string>();

  private createToken(type: string) {
    return `[[${type}_${this.counter++}]]`;
  }

  private getOrCreateToken(type: string, value: string) {
    for (const [token, tokenValue] of this.vault.entries()) {
      if (tokenValue === value) {
        return token;
      }
    }

    const token = this.createToken(type);
    this.vault.set(token, value);
    return token;
  }

  mask(text: string, matches: { type: string; value: string }[]): PiiResult {
    let masked = text;

    for (const match of matches) {
      if (!match.value || !masked.includes(match.value)) {
        continue;
      }

      const token = this.getOrCreateToken(match.type, match.value);
      this.piiTypes.add(match.type.toLowerCase());

      masked = masked.split(match.value).join(token);
    }

    return {
      maskedText: masked,
      pii: Object.fromEntries(this.vault),
      piiTypes: Array.from(this.piiTypes)
    };
  }

  unmask(text: string): string {
       let result = text;
       this.vault.forEach((value, token) => {
         result = result.split(token).join(value); // Global replacement
       });
       return result;
    }

  getVault() {
    return Object.fromEntries(this.vault);
  }
}
