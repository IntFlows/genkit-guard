import { analyzeIntentStructured, detectInjection } from '../intent/intentAnalyzer.js';
import { detectPII } from '../pii/detector.js';
import { PiiTokenizer } from '../pii/tokenizer.js';

export function guard(config: any) {
  return async (req: any, next: any) => {
    const input =
      req.prompt ||
      req.messages?.[req.messages.length - 1]?.content?.[0]?.text ||
      "";

    // -------------------------
    // 1. INTENT ANALYSIS
    // -------------------------
    const isInjection = await detectInjection(input);

    if (isInjection) {
      console.warn(`[Intent Guard] Prompt injection pattern detected in input`);
      return block("Prompt injection detected", {
      reason: "pattern_match"
      });
    }

    console.log(`[Intent Guard] Analyzing intent for input: "${input}"`);
    
    const intentResult = await analyzeIntentStructured(
      input,
      config.intent.semantic.intents,
      config.intent.semantic.threshold
    );

    console.log(`[Intent Guard] Detected intent: ${intentResult.intent} (score: ${intentResult.score.toFixed(2)})`);

    if (!intentResult.allowed) {
        console.warn(`[Intent Guard] Intent "${intentResult.intent}" not allowed ${intentResult.allowed}`);
      return block("Intent not allowed", {
        intent: intentResult.intent,
        score: intentResult.score
      });
    }

    // -------------------------
    // 2. PII DETECTION + MASKING
    // -------------------------
    const piiMatches = await detectPII(input);
    console.log(`[PII Guard] Detected PII: ${piiMatches.length} matches found`);
    const tokenizer = new PiiTokenizer();   // <-- SINGLE INSTANCE

    const piiResult = tokenizer.mask(input, piiMatches);

    console.log(`[PII Guard] Masked PII: ${piiResult.piiTypes.length} types found`);

    // Attach tokenizer so response can unmask
    req.metadata = {
      ...req.metadata,
      piiTokenizer: tokenizer,
      intent: intentResult.intent,
      score: intentResult.score,
      piiDetected: piiMatches.length > 0,
      piiTypes: piiResult.piiTypes,
      maskedInput: piiResult.maskedText
    };

    // Replace input
    req.prompt = piiResult.maskedText;
    req.messages = [
      {
        role: 'user',
        content: [{ text: piiResult.maskedText }],
      },
    ];

    // -------------------------
    // 3. LLM CALL
    // -------------------------
    const res = await next(req);
    
    // -------------------------
    // 4. RESPONSE UNMASK
    // -------------------------
    console.log(`[PII Guard] Unmasking response if needed`);

    if (tokenizer) {
      /**
       * RECURSIVE TRANSFORMER
       * This will find every string in the Genkit response (no matter if it's in 
       * candidates, message, custom, or output) and unmask it.
       */
      const transform = (obj: any): any => {
        // 1. If it's a string, unmask it
        if (typeof obj === 'string') {
          return tokenizer.unmask(obj);
        }
        
        // 2. If it's an array, transform each element
        if (Array.isArray(obj)) {
          return obj.map(transform);
        }
        
        // 3. If it's an object, transform each value
        if (obj !== null && typeof obj === 'object') {
          // Note: We iterate keys and mutate the object directly 
          // to ensure Genkit's internal references are updated.
          for (const key of Object.keys(obj)) {
            obj[key] = transform(obj[key]);
          }
          return obj;
        }
        
        // 4. Return as-is for numbers/booleans/null
        return obj;
      };
    
    // ----------------------------------------------------------------------
    // 5. Transform the entire response object in-place to unmask all strings
    // ----------------------------------------------------------------------      
      transform(res);
      
      console.log("[PII Guard] Deep unmasking complete across all candidates and custom fields.");
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
