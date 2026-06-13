import { PiiTokenizer } from '../pii/tokenizer.js';

export interface ToolCallPiiMetadata {
  path: string;
  toolName?: string;
  piiDetected: boolean;
  piiTokenCount: number;
  piiTypes: string[];
}

const TOOL_INPUT_KEYS = ['input', 'args', 'arguments'];
const TOKEN_PATTERN = /\[\[([A-Z0-9_]+)_\d+\]\]/g;

export function unmaskToolCallInputs(
  value: unknown,
  tokenizer: PiiTokenizer
): { value: unknown; toolCalls: ToolCallPiiMetadata[] } {
  const toolCalls: ToolCallPiiMetadata[] = [];
  const transformed = visit(value, '$', tokenizer, toolCalls);

  return {
    value: transformed,
    toolCalls
  };
}

export function containsToolCalls(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsToolCalls);
  }

  const record = value as Record<string, unknown>;
  if (record.toolRequest || record.toolRequests || isToolCallLike(record)) {
    return true;
  }

  return Object.values(record).some(containsToolCalls);
}

function visit(
  value: unknown,
  path: string,
  tokenizer: PiiTokenizer,
  toolCalls: ToolCallPiiMetadata[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => visit(item, `${path}[${index}]`, tokenizer, toolCalls));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const processedKeys = new Set<string>();

  if (record.toolRequest && typeof record.toolRequest === 'object') {
    record.toolRequest = processToolCall(record.toolRequest as Record<string, unknown>, `${path}.toolRequest`, tokenizer, toolCalls);
    processedKeys.add('toolRequest');
  }

  if (Array.isArray(record.toolRequests)) {
    record.toolRequests = record.toolRequests.map((toolRequest, index) =>
      processToolCall(toolRequest as Record<string, unknown>, `${path}.toolRequests[${index}]`, tokenizer, toolCalls)
    );
    processedKeys.add('toolRequests');
  }

  if (isToolCallLike(record)) {
    return processToolCall(record, path, tokenizer, toolCalls);
  }

  for (const key of Object.keys(record)) {
    if (processedKeys.has(key)) {
      continue;
    }

    record[key] = visit(record[key], `${path}.${key}`, tokenizer, toolCalls);
  }

  return record;
}

function processToolCall(
  toolCall: Record<string, unknown>,
  path: string,
  tokenizer: PiiTokenizer,
  toolCalls: ToolCallPiiMetadata[]
): Record<string, unknown> {
  const piiTypes = new Set<string>();
  let piiTokenCount = 0;

  for (const key of TOOL_INPUT_KEYS) {
    if (!(key in toolCall)) {
      continue;
    }

    const before = toolCall[key];
    const tokenInfo = inspectTokens(before);
    piiTokenCount += tokenInfo.count;
    tokenInfo.types.forEach(type => piiTypes.add(type));
    toolCall[key] = unmaskStrings(before, tokenizer);
  }

  toolCalls.push({
    path,
    toolName: getToolName(toolCall),
    piiDetected: piiTokenCount > 0,
    piiTokenCount,
    piiTypes: Array.from(piiTypes)
  });

  return toolCall;
}

function unmaskStrings(value: unknown, tokenizer: PiiTokenizer): unknown {
  if (typeof value === 'string') {
    return tokenizer.unmask(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => unmaskStrings(item, tokenizer));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      record[key] = unmaskStrings(record[key], tokenizer);
    }

    return record;
  }

  return value;
}

function isToolCallLike(record: Record<string, unknown>): boolean {
  const hasToolName = typeof record.name === 'string' || typeof record.toolName === 'string';
  const hasToolInput = TOOL_INPUT_KEYS.some(key => key in record);

  return hasToolName && hasToolInput;
}

function getToolName(record: Record<string, unknown>): string | undefined {
  if (typeof record.name === 'string') {
    return record.name;
  }

  if (typeof record.toolName === 'string') {
    return record.toolName;
  }

  return undefined;
}

function inspectTokens(value: unknown): { count: number; types: string[] } {
  const text = collectStrings(value).join(' ');
  const types = new Set<string>();
  let count = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    count += 1;
    types.add(match[1].toLowerCase());
  }

  return {
    count,
    types: Array.from(types)
  };
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }

  return [];
}
