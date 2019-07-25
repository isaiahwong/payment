require('@babel/polyfill');

// Setup Bluebird as the global promise library
global.Promise = require('bluebird');

// load env variables
require('./lib/setupEnv').config();

const path = require('path');
const logger = require('esther');

const GrpcServer = require('./grpc');
const { setupLanguage } = require('./lib/i18n');
const mongoConnect = require('./lib/mongoose');
// import { initServices } from './lib/services';
const pkg = require('../package.json');

// initialise logger
logger.init({
  useFileTransport: true,
  logDirectory: path.join(__dirname, '..', 'logs'),
  disableStackTrace: true,
  useStackDriver: process.env.ENABLE_STACKDRIVER === 'true',
  stackDriverOpt: {
    serviceName: 'payment',
    ver: pkg.version
  }
});

setupLanguage();
mongoConnect();

process.on('unhandledRejection', (reason, p) => {
  logger.error('Unhandled Rejection at:', p, 'reason:', reason.stack);
  // send entire app down. k8s will restart it
  process.exit(1);
});

const grpcServer = new GrpcServer();

grpcServer.listen();
