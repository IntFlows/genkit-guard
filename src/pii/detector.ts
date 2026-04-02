import { ModelSingleton } from '../util/singleton.js';

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

export async function detectPII(text: string) {
  const ner = await ModelSingleton.getNER();

  const results: { type: string; value: string }[] = [];

  // ---- NER ----
  const entities = await ner(text);

  for (const e of entities) {
    if (e.entity.includes('PER')) {
      results.push({ type: 'NAME', value: e.word.replace('##', '') });
    }
  }

  // ---- REGEX ----
  for (const rule of REGEX_RULES) {
    const matches = text.match(rule.pattern) || [];
    matches.forEach(m => results.push({ type: rule.type, value: m }));
  }

  return results;
}