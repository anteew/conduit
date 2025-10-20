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
  const visited = new Set<any>();

  function sizeOf(value: any): number {
    if (value === null || value === undefined) return 0;
    const t = typeof value;
    switch (t) {
      case 'string':
        return Buffer.byteLength(value, 'utf8');
      case 'number':
        return 8; // approximate
      case 'boolean':
        return 1;
      case 'bigint':
        return Buffer.byteLength(value.toString(), 'utf8');
      case 'function':
        return 0; // non-serializable; ignore
      case 'object':
        if (visited.has(value)) return 0; // avoid cycles
        visited.add(value);
        // Buffers / typed arrays: count actual bytes
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return (value as Buffer).length;
        if (ArrayBuffer.isView(value)) return (value as ArrayBufferView).byteLength;
        if (value instanceof Date) return Buffer.byteLength((value as Date).toISOString(), 'utf8');
        if (Array.isArray(value)) {
          let total = 0;
          for (const item of value) total += sizeOf(item);
          return total;
        }
        // Generic object: account for keys and values
        let total = 0;
        for (const key of Object.keys(value)) {
          total += Buffer.byteLength(key, 'utf8');
          try {
            total += sizeOf((value as any)[key]);
          } catch {
            // ignore property getter errors
          }
        }
        return total;
      default:
        return 0;
    }
  }

  return sizeOf(obj);
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
