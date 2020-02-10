/* eslint-disable no-nested-ternary */
import mongoose from 'mongoose';
import Promise from 'bluebird';
import logger from 'esther';

const { MAINTENANCE_MODE } = process.env;

/**
 * Mongo Initializers
 */
mongoose.Promise = Promise;

const maxTries = process.env.MONGO_RETRIES || 20; // Reconnects n times
const interval = process.env.MONGO_RETRIES_INTERVAL || 5000; //  In Milleseconds I.E. 5 seconds

let db = null;
let tries = 0; // tries counter

const mongooseOptions = {
  keepAlive: true,
  connectTimeoutMS: 30000, // Give up initial connection after 30 seconds
  useNewUrlParser: true,
  useFindAndModify: false,
  useCreateIndex: true,

  dbName: process.env.DB_NAME || 'payment',
  user: process.env.MONGO_INITDB_ROOT_USERNAME || 'user',
  pass: process.env.MONGO_INITDB_ROOT_PASSWORD || 'password',
  autoReconnect: true,
  reconnectTries: maxTries,
  reconnectInterval: interval,
};

// mongoose.set('maxTimeMS', 1000);

const NODE_DB_URI = __TEST__
  ? process.env.DB_URI_TEST
  : __PROD__
    ? process.env.DB_URI
    : process.env.DB_URI_DEV;

function connect() {
  mongoose.connect(NODE_DB_URI, mongooseOptions)
    .catch((err) => {
      logger.error(err);
    });
}

function getDB() {
  return db;
}

// Do not connect to MongoDB when in maintenance mode
if (MAINTENANCE_MODE !== 'true') {
  db = mongoose.connection;

  db.on('open', () => {
    logger.info(`Connected to the ${NODE_DB_URI}.`);
    // reset try counter;
    tries = 0;
  });

  db.on('error', (err) => {
    logger.error(`Database error: ${err}\n`);
    if (err.name === 'MongoNetworkError' && !(tries >= maxTries)) {
      setTimeout(() => {
        tries += 1;
        connect();
      }, interval);
    }
  });

  db.on('connecting', () => logger.verbose(`Connecting to the ${NODE_DB_URI}.`));
  db.on('reconnected', () => logger.info(`Reconnected to the ${NODE_DB_URI}.`));
  db.on('disconnected', () => logger.info('MongoDB disconnected!'));
  db.on('reconnectFailed', () => { logger.info('MongoDB gave up reconnecting'); });
}

/**
 * 0 = disconnected
 * 1 = connected
 * 2 = connecting
 * 3 = disconnecting
 */
// eslint-disable-next-line no-multi-assign
exports = module.exports = connect;
// eslint-disable-next-line no-multi-assign
exports = mongoose.connection;
export {
  getDB,
};
