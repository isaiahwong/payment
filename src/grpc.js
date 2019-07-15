import path from 'path';
import grpc from 'grpc';
import logger from 'esther';
import { grpcLoader } from 'grpc-utils';

import controllers from './controllers';

const PROTO_PATH = path.join(__dirname, '..', 'proto/payment/payment.proto');

class GrpcServer {
  constructor() {
    this._port = process.env.PORT || 50051;
    this._server = new grpc.Server();
    // Load proto to be injected to Grpc Server
    const proto = grpcLoader.loadProto(PROTO_PATH);
    this.loadCoreServices(proto);
  }

  loadCoreServices(proto) {
    this.pkg = Object.keys(proto)[0];
    this.service = Object.keys(proto[this.pkg])[0];
    this._server.addService(
      proto[this.pkg][this.service].service,
      GrpcServer.mapControllers(proto[this.pkg][this.service].service, controllers)
    );
  }

  /**
   * @param {Object} _service
   * @returns {Object} mapped rpc handlers
   */
  static mapControllers(_service, _handlers) {
    return Object.keys(_service)
      .reduce((obj, svcKey) => {
        const fn = _service[svcKey].originalName;
        const _obj = obj;
        if (_handlers[fn] || _handlers[svcKey]) {
          _obj[fn] = _handlers[fn] || _handlers[svcKey];
        }
        return _obj;
      }, {});
  }

  listen() {
    this._server.bind(`0.0.0.0:${this._port}`, grpc.ServerCredentials.createInsecure());
    this._server.start();
    logger.info(`${this.service} grpc server listening on ${this._port}`);
  }
}

export default GrpcServer;
