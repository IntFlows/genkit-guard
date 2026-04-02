import { analyzeIntent, detectInjection } from '../intent/intentEngine.js';
import { createPiiProcessor } from '../pii/piiEngine.js';

export function intentGuard(config: any) {
  return async (req: any, next: any) => {
    const text =
      req.prompt ||
      req.messages?.[req.messages.length - 1]?.content?.[0]?.text ||
      "";

    const intentDesc = config.intents[config.allowedIntent];

    const [score, isInjection] = await Promise.all([
      analyzeIntent(text, intentDesc),
      detectInjection(text)
    ]);

    console.log(`[Intent] score=${score.toFixed(3)} injection=${isInjection}`);

    if (isInjection) {
      return block("Prompt injection detected.");
    }

    if (score < (config.threshold ?? 0.7)) {
      return block(config.fallbackMessage || "Out of scope.");
    }

    // 🔒 INTENT LOCKING (IMPORTANT)
    req.messages = req.messages || [];
    req.messages.unshift({
      role: 'system',
      content: [{
        text: `You are ONLY allowed to perform this task: ${intentDesc}. If not, refuse.`
      }]
    });

    return next(req);
  };
}

export function piiGuard() {
  return async (req: any, next: any) => {
    const vault = new Map<string, string>();
    const counter = { value: 0 };

    const processor = await createPiiProcessor();

    const tokenize = async (text: string) =>
      processor(text, vault, counter);

    const detokenize = (text: string) => {
      let restored = text;
      vault.forEach((v, k) => {
        restored = restored.split(k).join(v);
      });
      return restored;
    };

    // ---- REQUEST MASKING ----
    if (req.messages) {
      for (const msg of req.messages) {
        for (const part of msg.content || []) {
          if (part.text) {
            part.text = await tokenize(part.text);
          }
        }
      }
    }

    // ---- LLM CALL ----
    const res = await next(req);

    // ---- RESPONSE UNMASK ----
    if (res.text) {
      res.text = detokenize(res.text);
    }

    if (res.message?.content) {
      res.message.content.forEach((p: any) => {
        if (p.text) p.text = detokenize(p.text);
      });
    }

    return res;
  };
}

function block(message: string) {
  return {
    finishReason: 'blocked',
    text: message,
    message: {
      role: 'model',
      content: [{ text: message }]
    }
  };
}