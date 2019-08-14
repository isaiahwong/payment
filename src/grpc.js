/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import path from 'path';
import fs from 'fs';
import grpc from 'grpc';
import logger from 'esther';
import { grpcLoader, encodeMetadata } from 'grpc-utils';
import { map, omit } from 'lodash';
import {
  InternalServerError,
  BadRequest,
  CustomError,
  ServiceUnavailable
} from 'horeb';

import i18n from './lib/i18n';
import { check } from './utils/validator';

const CONTROLLER_PATH = path.join(__dirname, 'controllers/');
const PROTO_PATH = path.join(__dirname, '..', 'proto/payment/payment.proto');

class GrpcServer {
  constructor() {
    this._port = process.env.PORT || 50051;
    this._server = new grpc.Server();
    // Load proto to be injected to Grpc Server
    const proto = grpcLoader.loadProto(PROTO_PATH);
    this.loadCoreServices(proto);
  }

  static iterate(filePath) {
    return fs
      .readdirSync(filePath)
      .reduce((obj, fileName) => {
        const _obj = obj;
        if (!fs.statSync(filePath + fileName).isFile()) { // Folder
          GrpcServer.iterate(`${filePath}${fileName}/`);
          return _obj;
        }
        if (fileName.match(/\.js$/)) {
          const controller = require(filePath + fileName);
          if (!controller) return _obj;

          return { ..._obj, ...controller };
        }
        return _obj;
      }, {});
  }

  /**
   * @param {Object} service
   * @param {Object} controllers
   * @returns {Object} mapped rpc handlers
   */
  static mapControllers(service, controllers) {
    return Object.keys(service)
      .reduce((obj, svcKey) => {
        const _obj = obj;
        // Retrieve the camel-cased function name
        const fn = service[svcKey].originalName;
        // checks if function definition exists
        if (controllers[fn] || controllers[svcKey]) {
          const keyInUse = controllers[fn] ? fn : svcKey;
          const handler = GrpcServer.handle(controllers[fn] || controllers[svcKey], keyInUse);
          _obj[fn] = handler;
          return _obj;
        }
        return _obj;
      }, {});
  }

  static handle(controller, fn) {
    if (!controller) {
      logger.warn('Missing controller');
      return null;
    }
    if (!fn) {
      logger.warn('Missing function definition');
      return null;
    }
    if (!controller.handler) {
      logger.warn(`No handler supplied for ${fn}`);
      return null;
    }

    const { validate, handler } = controller;
    return async (call, callback) => {
      let headers = { rpc: fn, peer: call.getPeer() };
      const startTime = GrpcServer.recordStartTime();
      const stubCallback = (err, res) => {
        GrpcServer.logRoute(headers, err, res, startTime);
        callback(err, res);
      };

      const { metadata } = call;
      const headersBin = metadata.get('headers-bin');
      if (headersBin && headersBin[0]) {
        try {
          if (Buffer.isBuffer(headersBin[0])) {
            headers = {
              ...headers,
              ...JSON.parse(headersBin.toString())
            };
          }
        }
        catch (err) {
          logger.error('Invalid headers', err);
        }
      }

      try {
        if (validate) {
          const errors = check(call.request, validate);
          if (errors) {
            const badRequest = new BadRequest(i18n.t('invalidReqParams'));
            badRequest.errors = errors;
            throw badRequest;
          }
        }
        // eslint-disable-next-line no-param-reassign
        call.headers = headers;
        const res = await handler(call);
        stubCallback(null, res); return;
      }
      catch (err) {
        GrpcServer.errorHandler(err, fn, stubCallback, headers);
      }
    };
  }

  static errorHandler(err, fn, callback, headers) {
    let responseErr = err instanceof CustomError ? err : null;

    // Handle mongoose validation errors
    if (err.name === 'ValidationError') {
      const model = err.message.split(' ')[0];
      responseErr = new BadRequest(`${model} validation failed`);
      responseErr.errors = map(err.errors, mongooseErr => ({
        message: mongooseErr.message,
        path: mongooseErr.path,
        value: mongooseErr.value,
      }));
    }

    switch (err.type) {
      case 'StripeCardError':
        // A declined card error
        responseErr = new BadRequest(err.message);
        break;
      case 'StripeRateLimitError':
        responseErr = new ServiceUnavailable(err.message);
        break;
      case 'StripeInvalidRequestError':
        responseErr = new InternalServerError(err.message);
        break;
      case 'StripeAPIError':
        responseErr = new InternalServerError(err.message);
        break;
      case 'StripeConnectionError':
        responseErr = new ServiceUnavailable(err.message);
        break;
      case 'StripeAuthenticationError':
        responseErr = new BadRequest(err.message);
        break;
      default:
        break;
    }

    if (!responseErr
      || responseErr.httpCode >= 500
      || responseErr.code === InternalServerError.code) {
      // Try to identify the error...
      // ...
      // Otherwise create an InternalServerError and use it
      // we don't want to leak anything, just a generic error message
      // Use it also in case of identified errors but with httpCode === 500
      responseErr = new InternalServerError();
    }

    const args = {
      rpc: fn,
      // don't send sensitive information that only adds noise
      headers: omit(headers, ['x-api-key', 'cookie', 'password', 'confirmPassword']),
      httpCode: responseErr.httpCode,
      grpcCode: responseErr.code,
      isHandledError: responseErr.httpCode < 500,
    };

    if (err.code && err.errors) {
      args.errors = err.errors;
    }

    // eslint-disable-next-line no-param-reassign
    err.name = `${err.name} rpc: ${err.code}`;
    // log the error
    logger.error(err, args);

    const metadata = encodeMetadata('object', responseErr);
    responseErr.metadata = metadata;

    callback(responseErr);
  }

  static recordStartTime() {
    return process.hrtime();
  }

  static getResponseTime(start) {
    if (!start) {
      return '';
    }
    const end = process.hrtime(start);
    const nanoseconds = (end[0] * 1e9) + end[1];
    return nanoseconds / 1e6;
  }

  static logRoute(headers, error, res, _start) {
    if (!headers) {
      return;
    }

    const {
      'x-real-ip': ip = '',
      peer,
      rpc,
      method = '',
      'x-original-uri': url = '',
      'content-length': contentLength = '',
      'user-agent': userAgent = '',
      referer
    } = headers;
    const status = (error && `${error.code}:${error.httpCode}`) || '200';
    const ms = GrpcServer.getResponseTime(_start);

    const message = [
      `[${ip || peer}]`,
      rpc,
      method,
      url,
      status,
      contentLength, '-',
      ms, 'ms'
    ].join(' ');

    const toBeLogged = {
      httpRequest: {
        status,
        requestUrl: url,
        requestMethod: method,
        remoteIp: ip || peer,
        responseSize: contentLength,
        userAgent
      },
      rpc,
      originalUrl: url,
      // eslint-disable-next-line dot-notation
      referer,
      remoteAddr: ip,
      // don't send sensitive information that only adds noise
      headers: omit(headers, ['x-api-key', 'cookie', 'password', 'confirmPassword']),
      body: omit(res, ['password', 'confirmPassword']),
      responseTime: {
        ms
      }
    };
    logger.route(message, toBeLogged);
  }

  loadCoreServices(proto) {
    if (!proto) {
      throw new InternalServerError('protos not found');
    }
    this.pkg = Object.keys(proto)[0];
    if (!this.pkg) {
      throw new InternalServerError('package not found');
    }
    this.service = Object.keys(proto[this.pkg])[0];

    const controllers = GrpcServer.iterate(CONTROLLER_PATH);
    this._server.addService(
      proto[this.pkg][this.service].service,
      GrpcServer.mapControllers(proto[this.pkg][this.service].service, controllers)
    );
  }

  listen() {
    this._server.bind(`0.0.0.0:${this._port}`, grpc.ServerCredentials.createInsecure());
    this._server.start();
    logger.info(`${this.service} grpc server listening on ${this._port}`);
  }
}

export default GrpcServer;
