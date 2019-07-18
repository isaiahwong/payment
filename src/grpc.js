/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import path from 'path';
import fs from 'fs';
import grpc from 'grpc';
import logger from 'esther';
import { grpcLoader, encodeArrayMetadata } from 'grpc-utils';
import { InternalServerError, BadRequest, CustomError } from 'horeb';
import { map, omit } from 'lodash';

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
          const handler = GrpcServer.injectMiddleware(controllers[fn] || controllers[svcKey], fn);
          _obj[fn] = handler;
          return _obj;
        }
        return _obj;
      }, {});
  }

  static injectMiddleware(controller, fn) {
    if (!controller) {
      logger.warn('Missing controller');
      return null;
    }

    if (!fn) {
      logger.warn('Missing function definition');
      return null;
    }

    const { validate, handler } = controller;

    if (!handler) {
      logger.warn(`No handler supplied for ${fn}`);
      return null;
    }

    const higherOrderFn = async (call, callback) => {
      const { metadata } = call;

      let headers = metadata.get('headers-bin');
      if (headers) {
        try {
          if (Buffer.isBuffer(headers)) {
            headers = JSON.parse(headers.toString());
          }
        }
        catch (err) {
          logger.error('Invalid headers');
          return callback(new InternalServerError());
        }
      }

      // Adds a validate middleware
      if (validate) {
        const errors = check(call.request, validate);
        if (errors) {
          const err = new BadRequest(i18n.t('invalidReqParams'));
          const errMeta = encodeArrayMetadata('errors', errors);
          err.metadata = errMeta;
          return callback(err);
        }
      }

      return new Promise((resolve, reject) => {
        handler(call, (err, response) => {
          if (err) {
            reject(err);
          }
          resolve(response);
        })
          .catch(err => reject(err)); // handle thrown errors
      })
        .then(res => callback(null, res))
        .catch(err => GrpcServer.errorHandler(err, fn, headers, callback));
    };

    return higherOrderFn;
  }

  static errorHandler(err, fn, headers, callback) {
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
    // log the error
    logger.error(err, args);
    if (responseErr.errors) {
      const metadata = encodeArrayMetadata('errors', responseErr.errors);
      responseErr.metadata = metadata;
    }
    callback(responseErr);
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
