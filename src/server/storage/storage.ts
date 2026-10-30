import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Stockage des photos et factures. Les clés sont générées par le serveur (jamais par l'utilisateur). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Vérifie/prépare le stockage au démarrage (ex. crée le bucket privé). */
  init?(): Promise<void>;
}

/** Supabase Storage, bucket privé, accès uniquement via la clé service_role côté serveur. */
export class SupabaseStorage implements StorageProvider {
  readonly name = 'supabase';
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async init(): Promise<void> {
    const { data } = await this.client.storage.getBucket(this.bucket);
    if (data) {
      if (data.public) throw new Error(`Le bucket Supabase « ${this.bucket} » est public : il doit être privé.`);
      return;
    }
    const { error } = await this.client.storage.createBucket(this.bucket, { public: false });
    if (error) throw new Error(`Création du bucket « ${this.bucket} » impossible : ${error.message}`);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: false });
    if (error) throw new Error(`Envoi vers Supabase Storage impossible : ${error.message}`);
  }

  async get(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Lecture Supabase Storage impossible : ${error?.message ?? 'fichier absent'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw new Error(`Suppression Supabase Storage impossible : ${error.message}`);
  }
}

/** Stockage disque (développement, ou hébergement sans Supabase Storage). */
export class LocalStorage implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + sep)) throw new Error('Clé de stockage invalide');
    return target;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** Stockage en mémoire pour les tests. */
export class MemoryStorage implements StorageProvider {
  readonly name = 'memory';
  readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    if (this.objects.has(key)) throw new Error('Objet déjà présent');
    this.objects.set(key, data);
  }

  async get(key: string): Promise<Buffer> {
    const data = this.objects.get(key);
    if (!data) throw new Error('Objet introuvable');
    return data;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
