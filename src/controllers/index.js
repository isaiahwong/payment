import logger from 'esther';

const api = {};

api.webhook = function handler(call, callback) {
  logger.info(call);
  callback(null);
};

export default api;
