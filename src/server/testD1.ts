/**
 * testD1.ts — a stand-in for Cloudflare D1 backed by a real, in-memory SQLite
 * database (Node's built-in `node:sqlite`). Test support only.
 *
 * D1 *is* SQLite, so running the API's actual SQL here exercises the schema,
 * the primary keys, `json_each`, and transaction roll-back for real, rather
 * than against a hand-written imitation. `batch()` mirrors D1's contract: the
 * statements run in one transaction and a failure undoes all of them.
 *
 * Key exports: `createTestD1`, `TestD1`.
 */

import { DatabaseSync } from 'node:sqlite';
import type { D1DatabaseLike, D1ResultLike, D1StatementLike } from './classApi';

type SqlValue = string | number | bigint | null;

class TestStatement implements D1StatementLike {
  constructor(
    private readonly db: DatabaseSync,
    private readonly owner: TestD1,
    readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): D1StatementLike {
    return new TestStatement(this.db, this.owner, this.sql, values as SqlValue[]);
  }

  /**
   * Execute synchronously; used directly and by `batch`. Like D1, `all()` and
   * `first()` return the statement's rows whatever kind of statement it is
   * (SELECT, PRAGMA, ...); `run()` returns rows for a query and the change count otherwise.
   */
  execute(wantRows = false): D1ResultLike {
    this.owner.statementsRun += 1;
    const statement = this.db.prepare(this.sql);
    if (wantRows || /^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql)) {
      return { success: true, results: statement.all(...this.params) as Record<string, unknown>[], meta: { changes: 0 } };
    }
    const info = statement.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }

  async run(): Promise<D1ResultLike> {
    return this.execute();
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return this.execute(true) as D1ResultLike<T>;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = this.execute(true).results ?? [];
    return (rows[0] as T | undefined) ?? null;
  }
}

export class TestD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(':memory:');
  /** Number of statements executed, so tests can check what a request cost. */
  statementsRun = 0;
  /** When set, the next `batch` throws after running this many statements (to test roll-back). */
  failBatchAfter: number | null = null;

  prepare(sql: string): D1StatementLike {
    return new TestStatement(this.sqlite, this, sql);
  }

  async batch(statements: D1StatementLike[]): Promise<D1ResultLike[]> {
    const results: D1ResultLike[] = [];
    this.sqlite.exec('BEGIN');
    try {
      for (let i = 0; i < statements.length; i++) {
        if (this.failBatchAfter !== null && i >= this.failBatchAfter) {
          this.failBatchAfter = null;
          throw new Error('simulated storage failure');
        }
        results.push((statements[i] as TestStatement).execute());
      }
      this.sqlite.exec('COMMIT');
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
    return results;
  }

  /** Read rows directly, bypassing the API (for assertions). */
  rows<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
}

export function createTestD1(): TestD1 {
  return new TestD1();
}
