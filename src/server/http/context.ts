import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../auth/session';
import { AppError, unauthorized } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export type RequestMeta = { userId: string | null; ip: string | null; userAgent: string | null };

/** Utilisateur authentifié, ou 401. Un mot de passe à changer bloque tout sauf le changement lui-même. */
export function requireAuth(request: FastifyRequest, options: { allowPendingPasswordChange?: boolean } = {}): AuthContext {
  const auth = request.auth;
  if (!auth) throw unauthorized();
  if (auth.user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Vous devez changer votre mot de passe avant de continuer');
  }
  return auth;
}

export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return { userId: request.auth?.user.id ?? null, ip: request.ip ?? null, userAgent: userAgent ? userAgent.slice(0, 300) : null };
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

export const IdParams = z.object({ id: z.uuid() });
export const BuildingParams = z.object({ buildingId: z.uuid() });
