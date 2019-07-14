import logger from 'esther';

const api = {};

api.check = function handler(call, callback) {
  logger.info(call.request.service);
  callback(null, { status: 'SERVING' });
};

export default api;
