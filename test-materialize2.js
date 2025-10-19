const ctx = {
  $path: '/v1/subscribe',
  $query: { stream: 'test/stream' },
  $headers: {}
};

console.log('ctx.$query:', ctx.$query);
console.log('ctx.$query.stream:', ctx.$query.stream);
console.log('ctx["$query"]:', ctx["$query"]);
console.log('ctx["$query"]["stream"]:', ctx["$query"]["stream"]);

function evalSelector(selector, ctx) {
  if (typeof selector === 'string') {
    if (selector.startsWith('$')) {
      const path = selector.slice(1).split('.');
      console.log('path:', path);
      let value = ctx;
      for (const key of path) {
        console.log(`  accessing key '${key}', current value:`, value);
        value = value?.[key];
      }
      console.log(`evalSelector('${selector}') = ${JSON.stringify(value)}`);
      return value;
    }
    return selector;
  }
  return selector;
}

evalSelector('$query.stream', ctx);
