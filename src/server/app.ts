import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { resolveSession, SESSION_COOKIE } from './auth/session';
import type { Env } from './env';
import { AppError, errorHandler } from './http/errors';
import { registerAuthRoutes } from './routes/auth';
import { registerBillRoutes } from './routes/bills';
import { registerBuildingRoutes } from './routes/buildings';
import { registerConsumerRoutes } from './routes/consumers';
import { registerFileRoutes } from './routes/files';
import { registerSystemRoutes } from './routes/system';
import { registerUserRoutes } from './routes/users';
import type { AppDeps } from './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  const base = {
    level: env.LOG_LEVEL,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  };
  if (env.LOG_FILE) return { ...base, file: env.LOG_FILE };
  if (env.NODE_ENV === 'development') {
    return { ...base, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } };
  }
  return base;
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Application Fastify complète : API REST sous /api et, si le frontend est compilé, l'application React.
 * Un seul processus Node sert tout (adapté à o2switch / Phusion Passenger).
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env, db } = deps;
  const app = Fastify({ logger: loggerOptions(env), trustProxy: env.TRUST_PROXY, bodyLimit: 1024 * 1024 });

  app.decorateRequest('auth', null);
  app.setErrorHandler(errorHandler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, { origin: env.allowedOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 5, parts: 6 },
    throwFileSizeLimit: true,
  });

  // HTTPS : le proxy d'o2switch signale le protocole d'origine.
  app.addHook('onRequest', async (request, reply) => {
    if (env.NODE_ENV === 'production' && request.headers['x-forwarded-proto'] === 'http') {
      return reply.redirect(`https://${request.hostname}${request.url}`, 301);
    }
  });

  // CSRF : toute requête qui modifie des données doit venir de l'application elle-même.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || SAFE_METHODS.has(request.method)) return;
    const origin = originOf(request.headers.origin) ?? originOf(request.headers.referer);
    if (!origin || !env.allowedOrigins.includes(origin)) {
      throw new AppError(403, 'CSRF_REJECTED', 'Origine de la requête non autorisée');
    }
  });

  // Session : cookie httpOnly → utilisateur.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await resolveSession(db, token) : null;
  });

  registerSystemRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerBuildingRoutes(app, deps);
  registerConsumerRoutes(app, deps);
  registerFileRoutes(app, deps);
  registerBillRoutes(app, deps);

  const spaIndex = deps.clientDir ? join(deps.clientDir, 'index.html') : null;
  const serveSpa = Boolean(deps.clientDir && spaIndex && existsSync(spaIndex));
  if (serveSpa && deps.clientDir) {
    await app.register(fastifyStatic, {
      root: deps.clientDir,
      wildcard: false,
      index: false,
      setHeaders: (reply, path) => {
        void reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (serveSpa && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route introuvable' } });
  });

  return app;
}
