/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import path from 'path';
import fs from 'fs';
import grpc from 'grpc';
import logger from 'esther';
import { grpcLoader, encodeArrayMetadata } from 'grpc-utils';
import { InternalServerError, BadRequest } from 'horeb';

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

  // /**
  //  * @param {Object} _service
  //  * @returns {Object} mapped rpc handlers
  //  */
  // static mapControllers(_service, _handlers) {
  //   return Object.keys(_service)
  //     .reduce((obj, svcKey) => {
  //       const fn = _service[svcKey].originalName;
  //       const _obj = obj;
  //       if (_handlers[fn] || _handlers[svcKey]) {
  //         _obj[fn] = _handlers[fn] || _handlers[svcKey];
  //       }
  //       return _obj;
  //     }, {});
  // }

  /**
   * @param {Object} service
   * @param {Object} controllers
   * @returns {Object} mapped rpc handlers
   */
  static mapControllers(service, controllers) {
    return Object.keys(service)
      .reduce((obj, svcKey) => {
        const _obj = obj;
        const fn = service[svcKey].originalName;
        if (controllers[fn] || controllers[svcKey]) {
          const { validate, handler } = controllers[fn] || controllers[svcKey];

          // Adds a validate middleware
          if (validate) {
            const middleware = (call, callback) => {
              const errors = check(call.request, validate);

              if (errors) {
                const err = new BadRequest(i18n.t('invalidReqParams'));
                const metadata = encodeArrayMetadata('errors', errors);
                err.metadata = metadata;
                return callback(err);
              }
              return handler(call, callback);
            };
            _obj[fn] = middleware;
          }
          else {
            _obj[fn] = handler;
          }
        }
        return _obj;
      }, {});
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
