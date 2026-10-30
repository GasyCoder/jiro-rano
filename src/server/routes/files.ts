import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { UploadResultDto } from '@shared/api';
import type { FileKind, Permission } from '@shared/domain';
import { FileKindQuerySchema } from '@shared/schemas';
import { requirePermission } from '../auth/access';
import { files } from '../db/schema';
import { ExtractionError } from '../extraction';
import { BuildingParams, IdParams, parse, requestMeta, requireAuth } from '../http/context';
import { AppError, badRequest, notFound } from '../http/errors';
import { sniffFileType } from '../storage/mime';
import { audit } from '../services/audit';
import { toFileDto } from '../services/dto';
import type { AppDeps } from '../types';

const permissionFor = (kind: FileKind): Permission => (kind === 'METER_PHOTO' ? 'reading.create' : 'bill.write');

export function registerFileRoutes(app: FastifyInstance, { db, storage, extractors }: AppDeps): void {
  /**
   * Envoi d'une photo de compteur ou de facture. La lecture automatique éventuelle est renvoyée
   * comme proposition : rien n'est enregistré comme relevé ou facture sans confirmation.
   */
  app.post('/api/buildings/:buildingId/files', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply): Promise<UploadResultDto> => {
    const auth = requireAuth(request);
    const { buildingId } = parse(BuildingParams, request.params);
    const { kind } = parse(FileKindQuerySchema, request.query);
    await requirePermission(db, auth.user, buildingId, permissionFor(kind));

    const part = await request.file();
    if (!part) throw badRequest('Aucun fichier reçu');
    const data = await part.toBuffer();
    const sniffed = sniffFileType(data);
    if (!sniffed || (sniffed.kind === 'pdf' && kind === 'METER_PHOTO')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Format non accepté : JPEG, PNG, WebP ou HEIC (PDF pour une facture)');
    }
    const now = new Date();
    const key = `${buildingId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${sniffed.ext}`;
    await storage.put(key, data, sniffed.mime);
    const [file] = await db
      .insert(files)
      .values({
        buildingId,
        kind,
        storageKey: key,
        mimeType: sniffed.mime,
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        originalName: part.filename ? part.filename.slice(0, 200) : null,
        uploadedBy: auth.user.id,
      })
      .returning();
    if (!file) throw new Error('Enregistrement du fichier impossible');
    await audit(db, requestMeta(request), {
      action: 'file.upload',
      entityType: 'file',
      entityId: file.id,
      buildingId,
      newValue: { kind, mimeType: sniffed.mime, sizeBytes: data.length },
    });

    const result: UploadResultDto = { file: toFileDto(file), extractor: kind === 'METER_PHOTO' ? extractors.meter.name : extractors.bill.name };
    try {
      if (kind === 'METER_PHOTO') result.meterReading = await extractors.meter.extract(data, sniffed.mime);
      else if (kind === 'BILL_PHOTO' || kind === 'BILL_PDF') result.bill = await extractors.bill.extract(data, sniffed.mime);
    } catch (error) {
      request.log.warn({ err: error }, 'Lecture automatique en échec');
      result.extractionError = error instanceof ExtractionError ? error.message : 'Lecture automatique impossible : saisissez les valeurs.';
    }
    return reply.status(201).send(result);
  });

  /** Les fichiers restent privés : ils transitent par le serveur après contrôle des droits. */
  app.get('/api/files/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const [file] = await db.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
    if (!file) throw notFound('Fichier');
    await requirePermission(db, auth.user, file.buildingId, 'building.read');
    const data = await storage.get(file.storageKey);
    return reply
      .header('Content-Type', file.mimeType)
      .header('Cache-Control', 'private, max-age=300')
      .header('Content-Disposition', 'inline')
      .header('X-Content-Type-Options', 'nosniff')
      .send(data);
  });

  app.delete('/api/files/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(IdParams, request.params);
    const [file] = await db.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
    if (!file) throw notFound('Fichier');
    await requirePermission(db, auth.user, file.buildingId, permissionFor(file.kind));
    await db.update(files).set({ deletedAt: new Date(), deletedBy: auth.user.id }).where(eq(files.id, id));
    await storage.remove(file.storageKey);
    await audit(db, requestMeta(request), {
      action: 'file.delete',
      entityType: 'file',
      entityId: id,
      buildingId: file.buildingId,
      oldValue: { kind: file.kind, sha256: file.sha256, originalName: file.originalName },
    });
    return reply.status(204).send();
  });
}
