export function transformStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return transform(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => transformStrings(item, transform));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      record[key] = transformStrings(record[key], transform);
    }

    return record;
  }

  return value;
}

export function collectText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join('\n');
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(collectText).filter(Boolean).join('\n');
  }

  return '';
}
