require('@babel/polyfill');
require('source-map-support').install();

// Setup Bluebird as the global promise library
global.Promise = require('bluebird');

// load env variables
require('./lib/setupEnv').config();

const path = require('path');
const logger = require('esther');

const GrpcServer = require('./lib/grpc');
const { setupLanguage } = require('./lib/i18n');
const mongoConnect = require('./lib/mongoose');
// import { initServices } from './lib/services';
const pkg = require('../package.json');

const CONTROLLER_PATH = path.join(__dirname, 'controllers/');
const PROTO_PATH = `${__dirname}/../proto/api/payment/payment.proto`;
const INCLUDES = [
  `${__dirname}/../proto/api`,
  `${__dirname}/../proto/third_party/googleapis`,
];

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

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection at: ${reason} ${reason.stack}`);
  // send entire app down. k8s will restart it
  process.exit(1);
});
const grpcServer = new GrpcServer({
  controllerPath: CONTROLLER_PATH,
  protoPath: PROTO_PATH,
  includes: INCLUDES,
  pkg: 'api.payment',
});

grpcServer.listen();
