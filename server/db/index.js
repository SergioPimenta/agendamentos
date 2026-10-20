import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * Camada mínima de banco com a mesma interface para SQLite (dev / instalação simples)
 * e MySQL (produção). As queries do projeto usam apenas SQL portável com placeholders `?`.
 *
 *   db.query(sql, params)  -> linhas
 *   db.get(sql, params)    -> primeira linha | undefined
 *   db.run(sql, params)    -> { insertId, changes }
 *   db.transaction(fn)     -> fn(tx) com as mesmas funções + tx.forUpdate(sql)
 */

const clean = (params = []) =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));

async function createSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  if (config.sqlitePath !== ':memory:') fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  const conn = new DatabaseSync(config.sqlitePath);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  // Uma única conexão: serializa transações para que nada "vaze" para dentro delas.
  let tail = Promise.resolve();
  const exclusive = (fn) => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };

  const ops = {
    query: async (sql, params) => conn.prepare(sql).all(...clean(params)),
    get: async (sql, params) => conn.prepare(sql).get(...clean(params)),
    run: async (sql, params) => {
      const r = conn.prepare(sql).run(...clean(params));
      return { insertId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    exec: async (sql) => conn.exec(sql),
    forUpdate: (sql) => sql,
  };

  return {
    dialect: 'sqlite',
    query: (s, p) => exclusive(() => ops.query(s, p)),
    get: (s, p) => exclusive(() => ops.get(s, p)),
    run: (s, p) => exclusive(() => ops.run(s, p)),
    exec: (s) => exclusive(() => ops.exec(s)),
    forUpdate: ops.forUpdate,
    transaction: (fn) =>
      exclusive(async () => {
        conn.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(ops);
          conn.exec('COMMIT');
          return out;
        } catch (err) {
          conn.exec('ROLLBACK');
          throw err;
        }
      }),
    close: async () => conn.close(),
  };
}

async function createMysql() {
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool({
    ...config.mysql,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
  });

  const bind = (c) => ({
    query: async (sql, params) => (await c.query(sql, clean(params)))[0],
    get: async (sql, params) => (await c.query(sql, clean(params)))[0][0],
    run: async (sql, params) => {
      const [r] = await c.query(sql, clean(params));
      return { insertId: r.insertId, changes: r.affectedRows };
    },
    exec: async (sql) => {
      await c.query(sql);
    },
    forUpdate: (sql) => `${sql} FOR UPDATE`,
  });

  return {
    dialect: 'mysql',
    ...bind(pool),
    forUpdate: (sql) => sql,
    transaction: async (fn) => {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const out = await fn(bind(c));
        await c.commit();
        return out;
      } catch (err) {
        await c.rollback();
        throw err;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

export const db = config.dbDriver === 'mysql' ? await createMysql() : await createSqlite();
