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

export type GuardLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GuardLogEvent {
  timestamp?: string;
  service?: string;
  level?: GuardLogLevel;
  event: string;
  message?: string;
  [key: string]: unknown;
}

export type GuardLogger = (event: GuardLogEvent) => void;

export interface GuardLoggingConfig {
  enabled?: boolean;
  service?: string;
  logger?: GuardLogger;
}

export interface ToolCallPiiMetadata {
  path: string;
  toolName?: string;
  piiDetected: boolean;
  piiTokenCount: number;
  piiTypes: string[];
}

export interface GuardConfig {
  intent: {
    mode?: 'semantic';
    allowedIntent?: string;
    semantic: {
      intents: Record<string, string>;
      threshold: number;
    };
  };
  pii?: {
    model?: string;
    mode?: 'ner' | 'classifier';
    reversible?: boolean;
  };
  logging?: GuardLoggingConfig;
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
