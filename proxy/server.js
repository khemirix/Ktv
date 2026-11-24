'use strict';

require('./src/config/env-file').loadEnvFile(__dirname);

const { createApp } = require('./src/app');
const { config } = require('./src/config');
const registry = require('./src/stream/registry');

const app = createApp({ config: config });
const server = app.server;

server.listen(config.port, config.host, function () {
  // Intentionally logs no URLs or credentials.
  // eslint-disable-next-line no-console
  console.log('Khemirix Smart Proxy ' + config.version + ' listening on port ' + config.port);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log('Received ' + signal + ', shutting down...');
  registry.destroyAll();
  server.close(function () {
    // eslint-disable-next-line no-console
    console.log('Shutdown complete.');
    process.exit(0);
  });
  setTimeout(function () { process.exit(0); }, 5000).unref();
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });
