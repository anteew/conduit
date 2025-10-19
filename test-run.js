import('./tests/T3022-ws-errors.test.js').catch(e => {
  console.error('Error loading test:', e);
  process.exit(1);
});
