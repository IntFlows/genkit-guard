import type { GuardConfig } from '../core/types.js';
import { analyzeIntentStructured, detectInjection } from '../intent/intentAnalyzer.js';
import { createLogger } from '../logging/logger.js';
import { detectPII } from '../pii/detector.js';
import { PiiTokenizer } from '../pii/tokenizer.js';
import { collectText, transformStrings } from './objectTransforms.js';
import { containsToolCalls, unmaskToolCallInputs } from './toolCalls.js';

export function guard(config: GuardConfig) {
  const log = createLogger(config?.logging);

  return async (req: any, next: any) => {
    const input =
      req.prompt ||
      req.messages?.[req.messages.length - 1]?.content?.[0]?.text ||
      collectText(req.messages) ||
      '';

    // -------------------------
    // 1. INTENT ANALYSIS
    // -------------------------
    const isInjection = await detectInjection(input);

    if (isInjection) {
      log({
        level: 'warn',
        event: 'guard.intent.injection_detected',
        message: 'Prompt injection pattern detected'
      });
      return block("Prompt injection detected", {
      reason: "pattern_match"
      });
    }

    log({
      level: 'info',
      event: 'guard.intent.analysis_started',
      message: 'Analyzing user intent'
    });
    
    const intentResult = await analyzeIntentStructured(
      input,
      config.intent.semantic.intents,
      config.intent.semantic.threshold
    );

    log({
      level: 'info',
      event: 'guard.intent.analysis_completed',
      intent: intentResult.intent,
      score: Number(intentResult.score.toFixed(4)),
      allowed: intentResult.allowed
    });

    if (!intentResult.allowed) {
      log({
        level: 'warn',
        event: 'guard.intent.blocked',
        intent: intentResult.intent,
        score: Number(intentResult.score.toFixed(4))
      });
      return block("Intent not allowed", {
        intent: intentResult.intent,
        score: intentResult.score
      });
    }

    // -------------------------
    // 2. PII DETECTION + MASKING
    // -------------------------
    const piiResponse = await detectPII(input, {
      model: config?.pii?.model,
      mode: config?.pii?.mode
    });
    const piiMatches = piiResponse?.matches || [];
    log({
      level: piiMatches.length > 0 ? 'warn' : 'info',
      event: 'guard.pii.detected',
      matchCount: piiMatches.length,
      classifierOutputPresent: Boolean(piiResponse.classifier)
    });
    const tokenizer = new PiiTokenizer();   // <-- SINGLE INSTANCE

    const piiResult = tokenizer.mask(input, piiMatches);

    log({
      level: 'info',
      event: 'guard.pii.masked',
      piiDetected: piiMatches.length > 0,
      piiTypes: piiResult.piiTypes,
      piiTypeCount: piiResult.piiTypes.length
    });

    // Attach tokenizer so response can unmask
    req.metadata = {
      ...req.metadata,
      piiTokenizer: tokenizer,
      intent: intentResult.intent,
      score: intentResult.score,
      piiDetected: piiMatches.length > 0,
      piiTypes: piiResult.piiTypes,
      maskedInput: piiResult.maskedText,
      piiModel: config?.pii?.model,
      piiMode: config?.pii?.mode,
      piiClassifierOutput: piiResponse.classifier
    };

    // Replace user-facing prompt fields while preserving existing message shape.
    if (typeof req.prompt === 'string') {
      req.prompt = tokenizer.mask(req.prompt, piiMatches).maskedText;
    }

    if (req.messages) {
      req.messages = transformStrings(req.messages, text => tokenizer.mask(text, piiMatches).maskedText);
    } else {
      req.messages = [
        {
          role: 'user',
          content: [{ text: piiResult.maskedText }],
        },
      ];
    }

    // -------------------------
    // 3. LLM CALL
    // -------------------------
    const res = await next(req);
    
    // -------------------------
    // 4. RESPONSE UNMASK
    // -------------------------
    log({
      level: 'info',
      event: 'guard.response.received',
      containsToolCalls: containsToolCalls(res)
    });

    if (tokenizer) {
      const hasToolCalls = containsToolCalls(res);

      if (hasToolCalls) {
        const toolResult = unmaskToolCallInputs(res, tokenizer);
        const toolCallsWithPii = toolResult.toolCalls.filter(toolCall => toolCall.piiDetected);

        res.metadata = {
          ...res.metadata,
          piiGuard: {
            ...res.metadata?.piiGuard,
            toolCalls: toolResult.toolCalls
          }
        };

        log({
          level: toolCallsWithPii.length > 0 ? 'warn' : 'info',
          event: 'guard.tool_calls.scanned',
          toolCallCount: toolResult.toolCalls.length,
          toolCallsWithPii: toolCallsWithPii.length,
          piiTypes: Array.from(new Set(toolCallsWithPii.flatMap(toolCall => toolCall.piiTypes)))
        });
      } else {
        transformStrings(res, text => tokenizer.unmask(text));
        
        log({
          level: 'info',
          event: 'guard.response.unmasked',
          message: 'Deep unmasking complete across response fields'
        });
      }
    }
    
    // ---------------------------------------------------------
    // 6. Return the modified response with unmasked content
    // ---------------------------------------------------------

    return res;

  };
}


// Helper to create a blocked response
function block(message: string, metadata?: any) {
  return {
    finishReason: 'blocked',
    output: {
      type: "error",
      status: "BLOCKED",
      message
    },
    metadata
  };
}
