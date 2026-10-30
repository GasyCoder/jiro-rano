import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentification requise') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Action non autorisée') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Ressource') => new AppError(404, 'NOT_FOUND', `${what} introuvable`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', message, details);

const PG_CONSTRAINT_MESSAGES: Record<string, string> = {
  users_email_unique: 'Cette adresse e-mail est déjà utilisée',
  meters_one_main_per_building: 'Ce bâtiment a déjà un compteur principal',
  consumers_meter_unique: 'Ce compteur est déjà attribué à un autre consommateur',
  bills_invoice_number_unique: 'Une facture avec ce numéro existe déjà pour ce bâtiment',
  building_members_unique: 'Cet utilisateur est déjà membre du bâtiment',
  allocations_one_official_per_bill: 'Une répartition officielle existe déjà pour cette facture',
  consumers_sub_meter_check: 'Un consommateur en mode sous-compteur doit avoir un compteur',
};

/** Format d'erreur unique : `{ error: { code, message, issues?, details? } }`. */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Données invalides',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  const pg = findPostgresError(error);
  if (pg) {
    const message = (pg.constraint && PG_CONSTRAINT_MESSAGES[pg.constraint]) ?? 'Opération refusée par la base de données';
    const status = pg.code === '23505' ? 409 : 400;
    request.log.warn({ code: pg.code, constraint: pg.constraint }, 'Contrainte PostgreSQL');
    void reply.status(status).send({ error: { code: 'CONSTRAINT_VIOLATION', message } });
    return;
  }
  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ err: error }, 'Erreur serveur');
    void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } });
    return;
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'REQUEST_ERROR';
  void reply.status(statusCode).send({ error: { code, message: error.message } });
}

type PgError = { code: string; constraint?: string };

function findPostgresError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^(23|22)\d{3}$/.test(candidate.code)) {
      const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : typeof candidate.constraint_name === 'string' ? candidate.constraint_name : undefined;
      return { code: candidate.code, ...(constraint ? { constraint } : {}) };
    }
    current = candidate.cause;
  }
  return null;
}
