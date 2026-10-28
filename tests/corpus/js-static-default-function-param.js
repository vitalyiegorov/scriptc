const DEFAULT_TEARDOWN = () => process.exit(1);
const rethrow = (err) => { throw err; };
class Zone {
  static label = 'zone';
  static run(callback, teardown = DEFAULT_TEARDOWN) {
    try { callback(); } catch (e) { console.log(this.label, 'caught', e.message); teardown(e); }
  }
}
class Factory {
  abortOnError;
  constructor(abortOnError) { this.abortOnError = abortOnError; }
  run(message) {
    const teardown = this.abortOnError === false ? rethrow : undefined;
    Zone.run(() => { throw new Error(message); }, teardown);
  }
}
try { new Factory(false).run('rethrown'); } catch (e) { console.log('outer', e.message); }
