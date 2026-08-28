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

export async function detectPII(text: string, opts?: { model?: string; mode?: 'ner' | 'classifier' }) {
  const mode = opts?.mode ?? 'ner';
  const model = opts?.model;

  const results: PiiMatch[] = [];

  // ---- REGEX (always run) ----
  for (const rule of REGEX_RULES) {
    const matches = text.match(rule.pattern) || [];
    matches.forEach(m => results.push({ type: rule.type, value: m }));
  }

  // ---- NER ----
  let classifierOutput: any = undefined;
  if (mode === 'ner') {
    const ner = await ModelSingleton.getNER(model);
    const entities = await ner(text);

    for (const e of entities) {
      if (e.entity && e.entity.includes('PER')) {
        results.push({ type: 'NAME', value: (e.word || '').replace(/##/g, '') });
      }
    }
  } else {
    // Privacy Filter is a token-classification model. Aggregation produces complete spans
    // rather than individual BIOES-labelled tokens.
    const cls = await ModelSingleton.getPIIClassifier(model);
    classifierOutput = await cls(text, { aggregation_strategy: 'simple' });
    for (const match of privacyFilterOutputToMatches(text, classifierOutput)) {
      if (!results.some((existing) => existing.value === match.value)) {
        results.push(match);
      }
    }
  }

  return {
    matches: results,
    classifier: classifierOutput
  };
}

export function privacyFilterOutputToMatches(text: string, output: unknown): PiiMatch[] {
  if (!Array.isArray(output)) return [];

  const matches: PiiMatch[] = [];
  for (const candidate of output) {
    if (!candidate || typeof candidate !== 'object') continue;

    const span = candidate as PrivacyFilterSpan;
    const rawLabel = span.entity_group ?? span.entity;
    if (typeof rawLabel !== 'string') continue;

    const label = rawLabel.replace(/^[BIES]-/, '').toLowerCase();
    const type = PRIVACY_FILTER_TYPE_MAP[label];
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
