// Intent Guard Types
export interface IntentGuardConfig {
  allowedIntent: string;
  intents: Record<string, string>; // name -> semantic description
  threshold?: number;              // default 0.7
  fallbackMessage?: string;
}

export interface IntentResult {
  allowed: boolean;
  score: number;
}



// PII Masking Types
export interface PiiRule {
  name: string;
  pattern: RegExp;
//   replaceWith: string;
}

export interface PiiConfig {
  rules?: PiiRule[];
  maskCharacter?: string; // e.g., "*"
}