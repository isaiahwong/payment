import morgan from './morgan';
import cors from './cors';
import notFound from './notFound';
import responseHandler from './responseHandler';
import errorHandler from './errorHandler';
import injectService from './injectService';
import webhook from './webhook';

export default function attachMiddleWares(app) {
  // trust proxy requests behind nginx.
  app.set('trust proxy', true);

  // attach res.respond and res.t
  app.use(responseHandler);

  // Inject external services in cluster
  app.use(injectService);

  // Logs every request
  app.use(morgan);

  // Set CORS
  cors(app);

  // Webhooks
  app.use(webhook);

  app.use(notFound);
  app.use(errorHandler);
}
