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

  mask(text: string, matches: { type: string; value: string }[]): PiiResult {
    let masked = text;

    for (const match of matches) {
      const token = this.createToken(match.type);

      this.vault.set(token, match.value);
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