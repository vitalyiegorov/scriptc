// Listener removal and class instanceof tests on a Node server held as an untyped value.
import http from 'node:http';

/** @type {any} */
const server = http.createServer((req, res) => res.end('ok'));
class Application {}
console.log(server instanceof Application, server instanceof Object);
const onError = (error) => console.log('error listener', error.message);
const onClose = () => console.log('removed close listener');
const kept = () => console.log('kept close listener');
console.log(server.once('error', onError) === server);
console.log(server.removeListener('error', onError) === server);
server.on('close', onClose);
server.on('close', kept);
console.log(server.off('close', onClose) === server);
server.listen(0, '127.0.0.1', () => {
  console.log('listening', typeof server.address().port);
  server.close(() => console.log('closed'));
});
