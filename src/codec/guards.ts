export interface DecodedGuardrails {
  maxDecodedSize: number;
  maxDepth: number;
}

export function getGuardrailsFromEnv(): DecodedGuardrails {
  return {
    maxDecodedSize: parseInt(process.env.CONDUIT_CODEC_MAX_DECODED_SIZE || '10485760', 10),
    maxDepth: parseInt(process.env.CONDUIT_CODEC_MAX_DEPTH || '32', 10)
  };
}

export function measureDecodedSize(obj: any): number {
  return JSON.stringify(obj).length;
}

export function measureDepth(obj: any, currentDepth = 0): number {
  if (obj === null || typeof obj !== 'object') {
    return currentDepth;
  }
  
  let maxChildDepth = currentDepth;
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const childDepth = measureDepth(item, currentDepth + 1);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }
  } else {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const childDepth = measureDepth(obj[key], currentDepth + 1);
        maxChildDepth = Math.max(maxChildDepth, childDepth);
      }
    }
  }
  
  return maxChildDepth;
}

export function checkDecodedPayload(
  obj: any,
  guardrails: DecodedGuardrails
): { valid: true } | { valid: false; reason: string; limit: number; actual: number } {
  const size = measureDecodedSize(obj);
  if (size > guardrails.maxDecodedSize) {
    return {
      valid: false,
      reason: 'decoded_size_exceeded',
      limit: guardrails.maxDecodedSize,
      actual: size
    };
  }
  
  const depth = measureDepth(obj);
  if (depth > guardrails.maxDepth) {
    return {
      valid: false,
      reason: 'depth_exceeded',
      limit: guardrails.maxDepth,
      actual: depth
    };
  }
  
  return { valid: true };
}
