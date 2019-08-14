/* eslint-disable no-console */
import logger from 'esther';
import path from 'path';
import { GrpcClient } from 'grpc-utils';

class PaymentService extends GrpcClient {
  constructor() {
    super(
      path.join(__dirname, '..', 'proto', 'payment', 'payment.proto'),
      {
        serviceURL: '127.0.0.1:50051',
        rpcMaxRetries: 4,
        rpcRetryInterval: 3000
      }
    );
  }
}

const service = new PaymentService();

async function test() {
  try {
    console.time();
    const res = await service.addCard({
      payment_method: 'sad',
      user: 'asd'
    }, null, { deadline: Date.now() + 3000 });
    console.timeEnd();
    logger.info(res);
  }
  catch (err) {
    logger.error(err);
  }
}

service.verbose = true;
setTimeout(() => test(), 3000);

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection at: ${reason} ${reason.stack}`);
  // send entire app down. k8s will restart it
  process.exit(1);
});

// Try rpc method
// Set deadline for each call
// catch failed to connect
// testconnection
// kill connection
