/* eslint import/first: 0 */
import express from 'express';
import http from 'http';
import helmet from 'helmet';
import logger from 'esther';

import attachMiddlewares from './middlewares';

class HttpServer {
  /**
   * @param {Object} options
   * @param {String} options.port Http Port
   */
  constructor(options = {}) {
    // const { services } = options;
    this.server = http.createServer();
    this.app = express();

    // initServicesz(services);
    this.app.set('port', options.port || process.env.HTTP_PORT || 5000);

    // secure app by setting various HTTP headers.
    this.app.use(helmet());
  }

  listen() {
    attachMiddlewares(this.app, this.server);

    this.server.on('request', this.app);
    this.server.listen(this.app.get('port'), () => {
      logger.info(`Node Server listening on port ${this.app.get('port')}`);
      logger.verbose(`Running ${process.env.NODE_ENV}`);
    });
  }
}

export default HttpServer;
