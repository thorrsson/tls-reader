function installGracefulShutdown(parentPort, servers, exit, log = console.error) {
  if (!parentPort) throw new Error('Reader server requires an Electron utility process parent');
  let stopping = false;
  parentPort.on('message', (event) => {
    if (stopping || event.data?.type !== 'shutdown') return;
    stopping = true;
    Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    }))).then(() => exit(0)).catch((error) => {
      log('Reader server graceful shutdown failed:', error);
      exit(1);
    });
  });
}

module.exports = { installGracefulShutdown };
