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
    withLock: (fn) => fn(),
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
    withLock: (fn) => fn(),
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

// Tabelas sem coluna `id` (chave natural): o INSERT delas não pede RETURNING id.
const NO_ID_TABLES = new Set(['settings', 'business_hours', 'email_templates', 'schema_migrations']);

/** `?` -> `$1, $2...` (ignorando o que está entre aspas) e LIKE -> ILIKE (SQLite/MySQL não diferenciam maiúsculas). */
function toPostgres(sql) {
  let n = 0;
  let quote = null;
  let out = '';
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out.replace(/\bLIKE\b/gi, 'ILIKE');
}

const insertTable = (sql) => /^\s*INSERT\s+INTO\s+"?(\w+)"?/i.exec(sql)?.[1]?.toLowerCase();

async function createPostgres() {
  const pg = (await import('pg')).default;
  // COUNT/SUM chegam como bigint/numeric (texto); o resto do código espera números.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const poolMax = Number(process.env.DB_POOL_MAX) || 5;
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (err) => console.error('[db] conexão ociosa falhou:', err.message));

  const bind = (c) => ({
    query: async (sql, params) => (await c.query(toPostgres(sql), clean(params))).rows,
    get: async (sql, params) => (await c.query(toPostgres(sql), clean(params))).rows[0],
    run: async (sql, params) => {
      const table = insertTable(sql);
      const wantId = table && !NO_ID_TABLES.has(table) && !/\bRETURNING\b/i.test(sql);
      const r = await c.query(toPostgres(wantId ? `${sql} RETURNING id` : sql), clean(params));
      return { insertId: wantId ? Number(r.rows[0]?.id) : 0, changes: r.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await c.query(sql);
    },
    forUpdate: (sql) => `${sql} FOR UPDATE`,
  });

  const transaction = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(bind(c));
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  };

  return {
    dialect: 'postgres',
    ...bind(pool),
    forUpdate: (sql) => sql,
    transaction,
    // Trava de aviso do Postgres presa a uma transação (funciona também atrás do pooler do Neon).
    // Com 1 única conexão (testes) a trava prenderia a própria conexão; nesse caso ela é desnecessária.
    withLock: (fn) =>
      poolMax === 1 ? fn() : transaction(async (tx) => {
        await tx.exec('SELECT pg_advisory_xact_lock(727401)');
        return fn();
      }),
    close: () => pool.end(),
  };
}

export const db = config.dbDriver === 'postgres' ? await createPostgres() : config.dbDriver === 'mysql' ? await createMysql() : await createSqlite();
