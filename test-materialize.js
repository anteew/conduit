const ctx = {
  $path: '/v1/subscribe',
  $query: { stream: 'test/stream' },
  $headers: {}
};

function evalSelector(selector, ctx) {
  if (typeof selector === 'string') {
    if (selector.startsWith('$')) {
      const path = selector.slice(1).split('.');
      let value = ctx;
      for (const key of path) {
        value = value?.[key];
      }
      console.log(`evalSelector('${selector}') = ${JSON.stringify(value)}`);
      return value;
    }
    return selector;
  }
  return selector;
}

function materialize(obj, ctx) {
  if (typeof obj === 'string') {
    return evalSelector(obj, ctx);
  }
  if (typeof obj === 'object' && obj !== null) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = materialize(value, ctx);
    }
    return result;
  }
  return obj;
}

const input = {
  message: {
    status: 'subscribed',
    stream: '$query.stream'
  }
};

console.log('Input:', JSON.stringify(input, null, 2));
const output = materialize(input, ctx);
console.log('Output:', JSON.stringify(output, null, 2));
