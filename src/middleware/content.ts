type Slot = { owner: any; key: string | number };

/** Select content fields by protocol position, never by arbitrary payload key names. */
function partSlots(content: any): Slot[] {
  if (!Array.isArray(content)) return [];
  const slots: Slot[] = [];
  for (let i = 0; i < content.length; i++) {
    const part = content[i];
    if (typeof part === 'string') { slots.push({ owner: content, key: i }); continue; }
    if (!part || typeof part !== 'object') continue;
    for (const key of ['text', 'reasoning', 'data']) {
      if (Object.hasOwn(part, key)) slots.push({ owner: part, key });
    }
    if (part.toolRequest && Object.hasOwn(part.toolRequest, 'input')) {
      slots.push({ owner: part.toolRequest, key: 'input' });
    }
    if (part.toolResponse) {
      if (Object.hasOwn(part.toolResponse, 'output')) slots.push({ owner: part.toolResponse, key: 'output' });
      slots.push(...partSlots(part.toolResponse.content));
    }
    // Metadata (including signatures), names, refs, media and custom protocol parts are opaque.
  }
  return slots;
}

export function requestContentSlots(req: any): Slot[] {
  return [
    ...(typeof req?.prompt === 'string' ? [{ owner: req, key: 'prompt' }] : partSlots(req?.prompt)),
    ...(req?.messages ?? []).flatMap((message: any) => partSlots(message?.content)),
    ...(req?.docs ?? []).flatMap((doc: any) => partSlots(doc?.content)),
  ];
}

export function lastMessageContentSlots(req: any): Slot[] {
  return typeof req?.prompt === 'string' || Array.isArray(req?.prompt)
    ? requestContentSlots({ prompt: req.prompt })
    : partSlots(req?.messages?.at(-1)?.content);
}

export function responseContentSlots(res: any): Slot[] {
  if (!res || typeof res !== 'object') return [];
  if (Array.isArray(res.message?.content) || Array.isArray(res.candidates)) {
    return [
      ...partSlots(res.message?.content),
      ...(res.candidates ?? []).flatMap((candidate: any) => partSlots(candidate.message?.content)),
      ...(Object.hasOwn(res, 'output') ? [{ owner: res, key: 'output' }] : []),
    ];
  }
  // Preserve legacy direct-hook structured responses, excluding envelope metadata.
  const envelope = new Set(['metadata', 'custom', 'raw', 'request', 'usage', 'finishReason', 'finishMessage']);
  return Object.keys(res).filter(key => !envelope.has(key)).map(key => ({ owner: res, key }));
}
