import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AllocationDetailDto,
  AllocationDraftDto,
  AuditLogDto,
  BillDto,
  BuildingDto,
  ConsumerDto,
  MeDto,
  MeterDto,
  Paginated,
  ReadingDto,
  SimulationDto,
  UploadResultDto,
  UserDto,
} from '@shared/api';
import { createTestContext, FAKE_JPEG, insertUser, TestClient, type TestContext } from './test/helpers';

const ADMIN = { email: 'admin@test.mg', password: 'admin-password-123' };

const OCTOBER_BILL = {
  periodStart: '2026-08-27',
  periodEnd: '2026-09-26',
  days: 30,
  mainMeterPreviousIndex: 50_898,
  mainMeterCurrentIndex: 51_311,
  electricityKwh: 443,
  electricityAmount: 328_798.76,
  waterAmount: 3_770,
  totalAmount: 332_568.76,
};

let ctx: TestContext;
let admin: TestClient;

/** Bâtiment complet : RDC et 2e avec sous-compteur, 1er par différence, relevés réels d'octobre 2026. */
async function setupBuilding(name: string) {
  const building = (await admin.post<BuildingDto>('/api/buildings', { name })).body;
  const meterRdc = (await admin.post<MeterDto>(`/api/buildings/${building.id}/meters`, { type: 'SUB_METER', label: 'SC RDC', rolloverAt: 10_000 })).body;
  const meter2e = (await admin.post<MeterDto>(`/api/buildings/${building.id}/meters`, { type: 'SUB_METER', label: 'SC 2e', rolloverAt: 10_000 })).body;
  const rdc = (await admin.post<ConsumerDto>(`/api/buildings/${building.id}/consumers`, { name: 'RDC', allocationMode: 'SUB_METER', meterId: meterRdc.id })).body;
  const first = (await admin.post<ConsumerDto>(`/api/buildings/${building.id}/consumers`, { name: '1er étage', allocationMode: 'DIFFERENCE' })).body;
  const second = (await admin.post<ConsumerDto>(`/api/buildings/${building.id}/consumers`, { name: '2e étage', allocationMode: 'SUB_METER', meterId: meter2e.id })).body;
  const reading = async (meterId: string, readingDate: string, readingTime: string, value: number) =>
    (await admin.post<ReadingDto>(`/api/meters/${meterId}/readings`, { readingDate, readingTime, value, confirmed: true })).body;
  const readings = {
    rdcStart: await reading(meterRdc.id, '2026-09-24', '21:05:57', 4757),
    rdcEnd: await reading(meterRdc.id, '2026-09-29', '09:07:20', 4801.5),
    secondStart: await reading(meter2e.id, '2026-08-27', '16:18', 8073.3),
    secondEnd: await reading(meter2e.id, '2026-09-27', '14:25', 8092.3),
  };
  return { building, meterRdc, meter2e, rdc, first, second, readings };
}

beforeAll(async () => {
  ctx = await createTestContext();
  await insertUser(ctx.db, { ...ADMIN, role: 'SUPERADMIN', name: 'Admin' });
  admin = new TestClient(ctx.app);
  expect((await admin.login(ADMIN.email, ADMIN.password)).status).toBe(200);
});

afterAll(async () => {
  await ctx?.close();
});

describe('sécurité de base', () => {
  it('expose un contrôle de santé public', async () => {
    const response = await new TestClient(ctx.app).get<{ status: string }>('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('refuse les requêtes non authentifiées', async () => {
    expect((await new TestClient(ctx.app).get('/api/buildings')).status).toBe(401);
  });

  it('refuse des identifiants invalides sans révéler si le compte existe', async () => {
    const client = new TestClient(ctx.app);
    const wrongPassword = await client.login(ADMIN.email, 'mauvais-mot-de-passe');
    const unknownUser = await client.login('inconnu@test.mg', 'mauvais-mot-de-passe');
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('pose un cookie de session httpOnly', async () => {
    const response = await new TestClient(ctx.app).login(ADMIN.email, ADMIN.password);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejette une requête modifiante venant d’une autre origine (CSRF)', async () => {
    const response = await admin.request('POST', '/api/buildings', { name: 'Pirate' }, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_REJECTED');
  });

  it('valide les entrées avec Zod', async () => {
    const response = await admin.post<{ error: { code: string } }>('/api/buildings', { name: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('parcours complet d’une facture', () => {
  it('crée, simule, calcule, valide, corrige et verrouille une répartition traçable', async () => {
    const { building, rdc, first, second, readings } = await setupBuilding('Mangarivotra');
    expect(building.mainMeterId).toBeTruthy();
    expect(readings.rdcEnd.value).toBe(4801.5);
    expect(readings.rdcEnd.normalizedValue).toBe(4801);
    expect(readings.rdcEnd.validated).toBe(true);

    const unconfirmed = await admin.post(`/api/meters/${readings.rdcEnd.meterId}/readings`, { readingDate: '2026-10-01', value: 4900 });
    expect(unconfirmed.status).toBe(400);

    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).body;
    expect(bill.calculationStatus).toBe('NOT_CALCULATED');

    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    const rdcConfig = draft.config.consumers.find((c) => c.consumerId === rdc.id);
    expect(rdcConfig).toMatchObject({ method: 'SUB_METER', readingStartId: readings.rdcStart.id, readingEndId: readings.rdcEnd.id });

    const simulation = (await admin.post<SimulationDto>(`/api/bills/${bill.id}/allocations/simulate`, draft.config)).body;
    if (!simulation.ok) throw new Error(JSON.stringify(simulation.errors));
    expect(simulation.consumers.map((c) => [c.consumerId, c.wh, c.payableAmount])).toEqual([
      [rdc.id, 293_271, 218_925],
      [first.id, 131_295, 98_705],
      [second.id, 18_434, 14_939],
    ]);
    expect(simulation.warnings.map((w) => w.code)).toContain('MAIN_METER_MISMATCH');
    expect((await admin.get<AllocationDetailDto[]>(`/api/bills/${bill.id}/allocations`)).body).toHaveLength(0);

    const v1 = await admin.post<AllocationDetailDto>(`/api/bills/${bill.id}/allocations`, draft.config);
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ version: 1, status: 'CALCULATED', totalAmount: 332_568.76, totalPayable: 332_569 });
    expect(v1.body.items.map((i) => [i.consumerName, i.provenance, i.kwh])).toEqual([
      ['RDC', 'PRORATED', 293.271],
      ['1er étage', 'DIFFERENCE', 131.295],
      ['2e étage', 'PRORATED', 18.434],
    ]);
    expect(v1.body.items[0]).toMatchObject({ readingStartId: readings.rdcStart.id, readingEndId: readings.rdcEnd.id, measuredKwh: 44 });
    expect(v1.body.steps.find((s) => s.code === 'DIFFERENCE')?.formula).toBe('443 − 293,27 − 18,43');

    const validated = await admin.post<AllocationDetailDto>(`/api/allocations/${v1.body.id}/validate`);
    expect(validated.body.status).toBe('VALIDATED');
    expect((await admin.get<BillDto>(`/api/bills/${bill.id}`)).body.calculationStatus).toBe('VALIDATED');

    const withoutReason = await admin.post(`/api/bills/${bill.id}/allocations`, draft.config);
    expect(withoutReason.status).toBe(400);

    const correction = await admin.post<AllocationDetailDto>(`/api/bills/${bill.id}/allocations`, {
      ...draft.config,
      water: { mode: 'PROPORTIONAL', key: 'KWH' },
      correctionReason: 'Eau répartie selon la consommation, décision du 30/10',
    });
    expect(correction.body).toMatchObject({ version: 2, status: 'CALCULATED', correctionOfId: v1.body.id, waterMode: 'PROPORTIONAL' });
    expect((await admin.get<AllocationDetailDto>(`/api/allocations/${v1.body.id}`)).body.status).toBe('VALIDATED');

    await admin.post(`/api/allocations/${correction.body.id}/validate`);
    expect((await admin.get<AllocationDetailDto>(`/api/allocations/${v1.body.id}`)).body).toMatchObject({ status: 'SUPERSEDED', supersededById: correction.body.id });

    const locked = await admin.post<AllocationDetailDto>(`/api/allocations/${correction.body.id}/lock`);
    expect(locked.body.status).toBe('LOCKED');

    const auditLog = (await admin.get<Paginated<AuditLogDto>>(`/api/audit?billId=${bill.id}`)).body;
    expect(auditLog.items.map((a) => a.action)).toEqual(
      expect.arrayContaining(['bill.create', 'allocation.create', 'allocation.validate', 'allocation.correction', 'allocation.lock']),
    );
  });

  it('bloque la validation si un relevé utilisé a été modifié depuis le calcul', async () => {
    const { building, readings } = await setupBuilding('Bâtiment relevé modifié');
    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).body;
    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    const allocation = (await admin.post<AllocationDetailDto>(`/api/bills/${bill.id}/allocations`, draft.config)).body;

    const noReason = await admin.patch(`/api/readings/${readings.rdcEnd.id}`, { value: 4800 });
    expect(noReason.status).toBe(400);
    const edited = await admin.patch<ReadingDto>(`/api/readings/${readings.rdcEnd.id}`, { value: 4800, reason: 'Unités encore en rotation : lecture prudente' });
    expect(edited.body.normalizedValue).toBe(4800);
    expect((await admin.get<BillDto>(`/api/bills/${bill.id}`)).body.calculationStatus).toBe('OUTDATED');

    const validation = await admin.post<{ error: { message: string } }>(`/api/allocations/${allocation.id}/validate`);
    expect(validation.status).toBe(409);
    expect(validation.body.error.message).toContain('relevé');

    const auditLog = (await admin.get<Paginated<AuditLogDto>>(`/api/audit?buildingId=${building.id}&entityType=meter_reading`)).body;
    const update = auditLog.items.find((a) => a.action === 'reading.update');
    expect(update?.oldValue).toMatchObject({ value: '4801.500', normalizedValue: '4801.000' });
    expect(update?.newValue).toMatchObject({ value: '4800', reason: 'Unités encore en rotation : lecture prudente' });
  });

  it('ne rend pas une facture « à recalculer » quand seule la remarque d’un relevé change', async () => {
    const { building, readings } = await setupBuilding('Bâtiment remarque');
    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).body;
    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    await admin.post(`/api/bills/${bill.id}/allocations`, draft.config);

    await admin.patch(`/api/readings/${readings.rdcEnd.id}`, { notes: 'Photo prise à contre-jour', reason: 'Précision ajoutée' });
    await admin.patch(`/api/readings/${readings.rdcEnd.id}`, { readingTime: '09:07:20', reason: 'Même heure ressaisie' });
    expect((await admin.get<BillDto>(`/api/bills/${bill.id}`)).body.calculationStatus).toBe('CALCULATED');

    const detail = (await admin.get<AllocationDetailDto[]>(`/api/bills/${bill.id}/allocations`)).body[0];
    const full = (await admin.get<AllocationDetailDto>(`/api/allocations/${detail?.id}`)).body;
    expect(full.readings.map((r) => r.meterLabel)).toEqual(expect.arrayContaining(['SC RDC', 'SC 2e']));
  });

  it('enregistre comme brouillon non validable une répartition où les sous-compteurs dépassent le compteur principal', async () => {
    const { building } = await setupBuilding('Bâtiment incohérent');
    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, { ...OCTOBER_BILL, electricityKwh: 50 })).body;
    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    const allocation = (await admin.post<AllocationDetailDto>(`/api/bills/${bill.id}/allocations`, draft.config)).body;
    expect(allocation.status).toBe('DRAFT');
    expect(allocation.errors.map((e) => e.code)).toEqual(['SUBMETERS_EXCEED_MAIN']);
    expect(allocation.items).toHaveLength(0);
    expect((await admin.post(`/api/allocations/${allocation.id}/validate`)).status).toBe(409);
  });

  it('exige une raison pour modifier les montants d’une facture déjà répartie', async () => {
    const { building } = await setupBuilding('Bâtiment facture modifiée');
    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).body;
    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    const allocation = (await admin.post<AllocationDetailDto>(`/api/bills/${bill.id}/allocations`, draft.config)).body;
    expect((await admin.patch(`/api/bills/${bill.id}`, { electricityKwh: 413 })).status).toBe(400);
    const updated = await admin.patch<BillDto>(`/api/bills/${bill.id}`, { electricityKwh: 413, reason: 'Index vérifié sur la facture papier' });
    expect(updated.body.calculationStatus).toBe('OUTDATED');
    expect((await admin.post(`/api/allocations/${allocation.id}/validate`)).status).toBe(409);
  });
});

describe('consommateurs et historique', () => {
  it('refuse de supprimer un consommateur présent dans l’historique, mais permet de le désactiver', async () => {
    const { building, rdc } = await setupBuilding('Bâtiment historique');
    const bill = (await admin.post<BillDto>(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).body;
    const draft = (await admin.get<AllocationDraftDto>(`/api/bills/${bill.id}/allocation-draft`)).body;
    await admin.post(`/api/bills/${bill.id}/allocations`, draft.config);

    expect((await admin.delete(`/api/consumers/${rdc.id}`)).status).toBe(409);
    expect((await admin.patch<ConsumerDto>(`/api/consumers/${rdc.id}`, { active: false })).body.active).toBe(false);

    const shop = (await admin.post<ConsumerDto>(`/api/buildings/${building.id}/consumers`, { name: 'Boutique', type: 'SHOP', allocationMode: 'EQUAL_SHARE' })).body;
    expect(shop.order).toBe(3);
    expect((await admin.delete(`/api/consumers/${shop.id}`)).status).toBe(204);

    const all = (await admin.get<ConsumerDto[]>(`/api/buildings/${building.id}/consumers?includeInactive=true`)).body;
    const reordered = await admin.post(`/api/buildings/${building.id}/consumers/reorder`, { ids: [...all.map((c) => c.id)].reverse() });
    expect(reordered.status).toBe(200);
    const active = (await admin.get<ConsumerDto[]>(`/api/buildings/${building.id}/consumers`)).body;
    expect(active.map((c) => c.name)).toEqual(['2e étage', '1er étage']);
  });

  it('refuse un sous-compteur déjà attribué', async () => {
    const { building, meterRdc } = await setupBuilding('Bâtiment compteur partagé');
    const response = await admin.post(`/api/buildings/${building.id}/consumers`, { name: 'Studio', allocationMode: 'SUB_METER', meterId: meterRdc.id });
    expect(response.status).toBe(409);
  });
});

describe('rôles et permissions', () => {
  it('impose le changement de mot de passe, puis limite un lecteur à la consultation de ses bâtiments', async () => {
    const { building } = await setupBuilding('Bâtiment lecteur');
    const other = await setupBuilding('Bâtiment privé');
    const created = await admin.post<UserDto>('/api/users', { email: 'locataire@test.mg', name: 'Locataire', password: 'provisoire-123' });
    expect(created.body.mustChangePassword).toBe(true);
    expect((await admin.post(`/api/buildings/${building.id}/members`, { email: 'locataire@test.mg', role: 'VIEWER' })).status).toBe(201);

    const tenant = new TestClient(ctx.app);
    await tenant.login('locataire@test.mg', 'provisoire-123');
    const blocked = await tenant.get<{ error: { code: string } }>('/api/buildings');
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await tenant.post('/api/auth/change-password', { currentPassword: 'provisoire-123', newPassword: 'nouveau-mot-de-passe' })).status).toBe(204);

    const me = (await tenant.get<MeDto>('/api/auth/me')).body;
    expect(me.memberships).toEqual([expect.objectContaining({ buildingId: building.id, role: 'VIEWER', permissions: ['building.read', 'bill.read', 'report.share'] })]);
    expect((await tenant.get(`/api/buildings/${building.id}/bills`)).status).toBe(200);
    expect((await tenant.post(`/api/buildings/${building.id}/bills`, OCTOBER_BILL)).status).toBe(403);
    expect((await tenant.get(`/api/buildings/${other.building.id}`)).status).toBe(404);
    expect((await tenant.get('/api/users')).status).toBe(403);
    expect((await tenant.get(`/api/audit?buildingId=${building.id}`)).status).toBe(403);
  });

  it('empêche de retirer le dernier super-administrateur', async () => {
    const me = (await admin.get<MeDto>('/api/auth/me')).body;
    expect((await admin.patch(`/api/users/${me.user.id}`, { role: 'USER' })).status).toBe(400);
  });
});

describe('photos', () => {
  it('contrôle le type réel du fichier, propose une lecture sans rien enregistrer, et garde le fichier privé', async () => {
    const { building, meterRdc } = await setupBuilding('Bâtiment photos');
    const upload = await admin.upload<UploadResultDto>(`/api/buildings/${building.id}/files?kind=METER_PHOTO`, 'compteur.jpg', 'image/jpeg', FAKE_JPEG);
    expect(upload.status).toBe(201);
    expect(upload.body.file.mimeType).toBe('image/jpeg');
    expect(upload.body.meterReading).toMatchObject({ value: 4616.4, date: '2026-10-27' });
    expect((await admin.get<ReadingDto[]>(`/api/meters/${meterRdc.id}/readings`)).body).toHaveLength(2);

    const confirmed = await admin.post<ReadingDto>(`/api/meters/${meterRdc.id}/readings`, {
      readingDate: '2026-10-27',
      readingTime: '08:15',
      value: 4616.4,
      source: 'OCR',
      photoFileId: upload.body.file.id,
      confidenceScore: 0.9,
      extracted: { value: 4616.4 },
      confirmed: true,
    });
    expect(confirmed.body).toMatchObject({ normalizedValue: 4616, source: 'OCR', photoUrl: `/api/files/${upload.body.file.id}` });

    const download = await admin.get(`/api/files/${upload.body.file.id}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/jpeg');
    expect(download.raw.equals(FAKE_JPEG)).toBe(true);
    expect((await new TestClient(ctx.app).get(`/api/files/${upload.body.file.id}`)).status).toBe(401);

    const disguised = await admin.upload(`/api/buildings/${building.id}/files?kind=METER_PHOTO`, 'compteur.jpg', 'image/jpeg', Buffer.from('#!/bin/sh\necho pirate\n'));
    expect(disguised.status).toBe(415);

    expect((await admin.delete(`/api/files/${upload.body.file.id}`)).status).toBe(204);
    expect(ctx.storage.objects.size).toBe(0);
    expect((await admin.get(`/api/files/${upload.body.file.id}`)).status).toBe(404);
  });
});
