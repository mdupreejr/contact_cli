import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = process.env.CONTACTS_AI_DB || path.join(process.cwd(), 'data', 'ai.sqlite');

let db: Database.Database | null = null;
function ensureDir(p: string) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

export function openDB(): Database.Database {
  if (db) return db;
  ensureDir(DB_PATH);
  db = new Database(DB_PATH);
  sqliteVec.load(db); // registers vec0, distance, etc.
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists contact_meta (
      id text primary key,
      text text not null
    );
    create virtual table if not exists contact_vec using vec0(emb float[384]);
  `);
  return db!;
}

export function upsertEmbedding(id: string, text: string, emb: Float32Array) {
  const d = openDB();
  const tx = d.transaction(() => {
    d.prepare('insert or replace into contact_meta(id,text) values (?,?)').run(id, text);
    d.prepare(`
      insert or replace into contact_vec(rowid, emb)
      values ((select rowid from contact_meta where id = ?), ?)
    `).run(id, emb);
  });
  tx();
}

export function searchByEmbedding(emb: Float32Array, k = 20) {
  const d = openDB();
  return d.prepare(`
    select contact_meta.id as id, contact_meta.text as text, distance
    from contact_vec join contact_meta on contact_vec.rowid = contact_meta.rowid
    where emb match ? and k = ?
    order by distance asc
  `).all(emb, k) as { id: string; text: string; distance: number }[];
}
