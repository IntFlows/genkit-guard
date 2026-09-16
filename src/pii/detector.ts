import type { GuardConfig } from '../middleware/middleware.js';
import { runGuardModel } from '../util/fallback.js';
import type { PiiLabelMappings } from '../guard.config.js';
import { ModelSingleton } from '../util/singleton.js';

export type PiiMatch = { type: string; value: string };

export type PrivacyFilterSpan = {
  entity_group?: string;
  entity?: string;
  word?: string;
  start?: number;
  end?: number;
  score?: number;
};

const PRIVACY_FILTER_TYPE_MAP: Record<string, string> = {
  account_number: 'ACCOUNT_NUMBER',
  private_address: 'ADDRESS',
  private_email: 'EMAIL',
  private_person: 'NAME',
  private_phone: 'PHONE',
  private_url: 'URL',
  private_date: 'DATE',
  secret: 'SECRET',
};

const REGEX_RULES = [
  // EMAIL (keep your existing one)
  { type: 'EMAIL', pattern: /\b[\w\.-]+@[\w\.-]+\.\w{2,}\b/gi },

  // AU MOBILE (04xx xxx xxx or +61 4xx xxx xxx)
  { type: 'AU_MOBILE', pattern: /\b(?:\+?61|0)4\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g },

  // AU LANDLINE (02, 03, 07, 08)
  { type: 'AU_LANDLINE', pattern: /\b(?:\+?61[-\s]?)?(?:2|3|7|8)\d{1}[-\s]?\d{4}[-\s]?\d{4}\b/g },

  // MEDICARE NUMBER (10 digits, often grouped 4-5-1)
  { type: 'MEDICARE', pattern: /\b\d{4}[-\s]?\d{5}[-\s]?\d\b/g },

  // TFN (9 digits)
  { type: 'TFN', pattern: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g },

  // ABN (11 digits)
  { type: 'ABN', pattern: /\b\d{2}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g },

  // CREDIT CARD (keep your existing one if needed)
  { type: 'CREDIT_CARD', pattern: /\b(?:\d[ -]*?){13,16}\b/g }
];

export async function detectPII(text: string, opts?: GuardConfig['pii'], config?: GuardConfig) {
  const mode = opts?.mode ?? 'ner';
  const model = opts?.model;

  const results: PiiMatch[] = [];

  // ---- REGEX (always run) ----
  for (const rule of REGEX_RULES) {
    const matches = text.match(rule.pattern) || [];
    matches.forEach(m => results.push({ type: rule.type, value: m }));
  }

  // Only model loading/inference is retried. Label mapping errors are not model failures.
  const infer = async (selected: { model?: string; mode?: 'ner' | 'classifier'; labelMappings?: PiiLabelMappings }, usedFallback = false) => {
    const selectedMode = selected.mode ?? mode;
    const pipeline = selectedMode === 'ner'
      ? await ModelSingleton.getNER(selected.model)
      : await ModelSingleton.getPIIClassifier(selected.model);
    const output = selectedMode === 'ner' ? await pipeline(text)
      : await pipeline(text, { aggregation_strategy: 'simple' });
    if (!Array.isArray(output)) throw new Error('Invalid PII model output');
    return { output, mode: selectedMode, labelMappings: selected.labelMappings, usedFallback,
      model: selected.model ?? (selectedMode === 'ner' ? 'Xenova/bert-base-NER' : 'openai/privacy-filter') };
  };
  const selected = await runGuardModel(config, 'pii',
    () => infer({ model, mode, labelMappings: opts?.labelMappings }),
    opts?.fallback ? () => infer(opts.fallback!, true) : undefined);
  let classifierOutput: any = undefined;
  if (selected.mode === 'ner') {
    for (const e of selected.output) {
      const mappedType = mappedLabel(e.entity_group ?? e.entity, selected.labelMappings);
      if (mappedType !== undefined) {
        if (mappedType) results.push(...privacyFilterOutputToMatches(text, [e], selected.labelMappings));
      } else if (e.entity && e.entity.includes('PER')) {
        results.push({ type: 'NAME', value: (e.word || '').replace(/##/g, '') });
      }
    }
  } else {
    classifierOutput = selected.output;
    for (const match of privacyFilterOutputToMatches(text, classifierOutput, selected.labelMappings)) {
      if (!results.some((existing) => existing.value === match.value)) results.push(match);
    }
  }

  return {
    matches: results,
    classifier: classifierOutput,
    effectiveModel: selected.model,
    effectiveMode: selected.mode,
    usedFallback: selected.usedFallback,
  };
}

export function privacyFilterOutputToMatches(text: string, output: unknown, labelMappings?: PiiLabelMappings): PiiMatch[] {
export function privacyFilterOutputToMatches(text: string, output: unknown, labelMappings?: PiiLabelMappings): PiiMatch[] {
  if (!Array.isArray(output)) return [];

  const matches: PiiMatch[] = [];
  for (const candidate of output) {
    if (!candidate || typeof candidate !== 'object') continue;

    const span = candidate as PrivacyFilterSpan;
    const rawLabel = span.entity_group ?? span.entity;
    if (typeof rawLabel !== 'string') continue;

    const label = rawLabel.replace(/^[BIES]-/, '').toLowerCase();
    const customType = mappedLabel(rawLabel, labelMappings);
    const type = customType !== undefined ? customType : (Object.hasOwn(PRIVACY_FILTER_TYPE_MAP, label) ? PRIVACY_FILTER_TYPE_MAP[label] : undefined);
    const customType = mappedLabel(rawLabel, labelMappings);
    const type = customType !== undefined ? customType : (Object.hasOwn(PRIVACY_FILTER_TYPE_MAP, label) ? PRIVACY_FILTER_TYPE_MAP[label] : undefined);
    if (!type) continue;

    let value: string | undefined;
    if (
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start! >= 0 &&
      span.end! > span.start! &&
      span.end! <= text.length
    ) {
      value = text.slice(span.start, span.end);
    } else if (typeof span.word === 'string') {
      value = span.word.trim();
    }

    if (!value || !text.includes(value)) continue;
    if (!matches.some((existing) => existing.value === value)) {
      matches.push({ type, value });
    }
  }

  return matches;
}

function mappedLabel(label: unknown, mappings?: PiiLabelMappings): string | null | undefined {
  if (typeof label !== 'string' || !mappings) return undefined;
  const normalize = (value: string) => value.replace(/^[BIES]-/i, '').toLowerCase();
  const entry = Object.entries(mappings).find(([key]) => normalize(key) === normalize(label));
  if (!entry) return undefined;
  const type = entry[1];
  if (type !== null && !/^[A-Z_]+$/.test(type)) {
    throw new Error('PII label mapping types must contain only uppercase letters and underscores');
  }
  return type;
}

function mappedLabel(label: unknown, mappings?: PiiLabelMappings): string | null | undefined {
  if (typeof label !== 'string' || !mappings) return undefined;
  const normalize = (value: string) => value.replace(/^[BIES]-/i, '').toLowerCase();
  const entry = Object.entries(mappings).find(([key]) => normalize(key) === normalize(label));
  if (!entry) return undefined;
  const type = entry[1];
  if (type !== null && !/^[A-Z_]+$/.test(type)) {
    throw new Error('PII label mapping types must contain only uppercase letters and underscores');
  }
  return type;
}
