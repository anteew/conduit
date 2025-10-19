import { loadDSL } from './src/dsl/loader.js';
import { DSLInterpreter } from './src/dsl/interpreter.js';

const config = loadDSL('config/rules.yaml');
const mockClient = {
  subscribe: (stream, cb) => ({ subscribed: stream }),
  grant: (n) => {},
  ack: (id) => {},
  nack: (id, delay) => {}
};

const interpreter = new DSLInterpreter(config, mockClient);

const ctx = {
  $path: '/v1/subscribe',
  $query: { stream: 'test/stream' },
  $headers: {}
};

interpreter.applyRules(ctx).then(result => {
  console.log('Result:', JSON.stringify(result, null, 2));
});
