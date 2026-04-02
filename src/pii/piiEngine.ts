import { ModelSingleton } from '../util/singleton.js';

const DEFAULT_RULES = [
  { name: 'EMAIL', pattern: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/gi },
  { name: 'PHONE', pattern: /\b(?:\+?\d{1,3})?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: 'CREDIT_CARD', pattern: /\b(?:\d[ -]*?){13,16}\b/g }
];

function mergeEntities(entities: any[]) {
  const merged: string[] = [];
  let current = '';

  for (const e of entities) {
    if (e.word.startsWith('##')) {
      current += e.word.replace('##', '');
    } else {
      if (current) merged.push(current);
      current = e.word;
    }
  }

  if (current) merged.push(current);
  return merged;
}

export async function createPiiProcessor() {
  const ner = await ModelSingleton.getNER();

  return async function process(text: string, vault: Map<string, string>, counterRef: { value: number }) {
    let cleaned = text;

    // NER masking
    const entities = await ner(text);
    const names = mergeEntities(entities).filter(x => x.length > 2);

    for (const name of names) {
      const token = `__NAME_${counterRef.value++}__`;
      vault.set(token, name);
      cleaned = cleaned.split(name).join(token);
    }

    // Regex masking
    for (const rule of DEFAULT_RULES) {
      cleaned = cleaned.replace(rule.pattern, (match) => {
        const token = `__${rule.name}_${counterRef.value++}__`;
        vault.set(token, match);
        return token;
      });
    }

    return cleaned;
  };
}