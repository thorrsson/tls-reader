const http = require('node:http');
const path = require('node:path');
const { installRequestAuthorization } = require('./desktop-server-auth.cjs');
const { installGracefulShutdown } = require('./desktop-server-shutdown.cjs');

const serverPath = process.env.TLS_READER_SERVER_PATH;
const token = process.env.TLS_READER_LOCAL_AUTH_TOKEN;
const port = Number(process.env.PORT);
if (!serverPath || !token || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Reader server bootstrap configuration is incomplete');
}

const servers = new Set();
installRequestAuthorization(http, port, token, (server) => servers.add(server));
installGracefulShutdown(process.parentPort, servers, (code) => process.exit(code));
require(path.resolve(serverPath));
