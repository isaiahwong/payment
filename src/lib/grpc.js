/* eslint-disable no-prototype-builtins */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import fs from 'fs';
import grpc from 'grpc';
import logger from 'esther';
import * as protoLoader from '@grpc/proto-loader';
import { encodeMetadata } from 'grpc-utils';
import { map, omit } from 'lodash';
import {
  InternalServerError,
  BadRequest,
  CustomError,
  ServiceUnavailable
} from 'horeb';

import i18n from './i18n';
import { check } from '../utils/validator';

class GrpcServer {
  constructor({
    controllerPath,
    protoPath,
    includes,
    pkg,
  }) {
    this._port = process.env.PORT || 50051;
    this._server = new grpc.Server();
    this.protoPath = protoPath;
    this.controllerPath = controllerPath;
    // Load proto to be injected to Grpc Server
    const options = {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [...includes]
    };
    const proto = protoLoader.loadSync(protoPath, options);
    this.loadCoreServices(proto, pkg);
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
          const controller = require(`${filePath}${fileName}`);
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
          if (!handler) return _obj;
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

    const errors = encodeMetadata('errors', responseErr);
    responseErr.metadata = errors;

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
    const def = GrpcServer.loadPackageDefinition(proto);

    this.pkg = def.pkg;
    this.service = def.serviceName;
    const controllers = GrpcServer.iterate(this.controllerPath);
    this._server.addService(
      def.service,
      GrpcServer.mapControllers(def.service, controllers)
    );
  }

  static loadPackageDefinition(packageDef) {
    const result = {};
    const keys = Object.keys(packageDef);
    for (let i = 0; i < keys.length; i += 1) {
      const serviceFqn = keys[i];
      const service = packageDef[serviceFqn];
      const nameComponents = serviceFqn.split('.');
      const serviceName = nameComponents[nameComponents.length - 1];
      // We are only interested in implemented services
      // Apparently grpc package `loadPackageDefinition` uses the same logic
      // to check for services. I could have misinterpret it.
      if (!service.hasOwnProperty('format')) {
        result.service = service;
        result.serviceName = serviceName;
        result.pkg = serviceFqn;
        break;
      }
    }
    return result;
  }

  listen() {
    this._server.bind(`0.0.0.0:${this._port}`, grpc.ServerCredentials.createInsecure());
    this._server.start();
    logger.info(`${this.service} grpc server listening on ${this._port}`);
  }
}

export default GrpcServer;
