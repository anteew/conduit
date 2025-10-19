function matchWs(ws, ctx) {
  if (ws.message) {
    if (!ctx.$message) return false;
  }
  return true;
}

// Connection context (no message)
const connCtx = { $path: '/v1/subscribe', $query: { stream: 'test' } };

// Message context
const msgCtx = { $path: '/v1/subscribe', $query: { stream: 'test' }, $message: { credit: 1 } };

// Rule with no message clause (connection rule)
const connRule = { path: '/v1/subscribe' };

// Rule with message clause (message rule)
const msgRule = { path: '/v1/subscribe', message: { 'json.has': 'credit' } };

console.log('Connection rule matches connection context:', matchWs(connRule, connCtx)); // should be true
console.log('Connection rule matches message context:', matchWs(connRule, msgCtx)); // should be true
console.log('Message rule matches connection context:', matchWs(msgRule, connCtx)); // should be false
console.log('Message rule matches message context:', matchWs(msgRule, msgCtx)); // should be true (if we check the field)
