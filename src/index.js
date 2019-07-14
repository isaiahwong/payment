require('@babel/polyfill');

// Setup Bluebird as the global promise library
global.Promise = require('bluebird');

const path = require('path');
const logger = require('esther');
const pkg = require('../package.json');

// load env variables
require('./lib/setupEnv').config();

// initialise logger
logger.init({
  useFileTransport: true,
  logDirectory: path.join(__dirname, '..', 'logs'),
  useStackDriver: process.env.ENABLE_STACKDRIVER === 'true',
  stackDriverOpt: {
    serviceName: 'dunamis',
    ver: pkg.version
  }
});

const Server = require('./server');

process.on('unhandledRejection', (reason, p) => {
  logger.error('Unhandled Rejection at:', p, 'reason:', reason);
  // send entire app down. k8s will restart it
  process.exit(1);
});

const server = new Server();

server.listen();
