/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- `pg` ships no types in this repo (no @types/pg) */
import { Client } from 'pg';
import { QueryRunner } from 'typeorm';
import { AddLocalization1788700000000 } from './1788700000000-add-localization';

/**
 * Runs the real SQL against Postgres. Set MIGRATION_TEST_DATABASE_URL to an *empty* disposable database; everything
 * happens inside one transaction that is rolled back, so nothing persists. Skipped otherwise.
 */
const url = process.env.MIGRATION_TEST_DATABASE_URL;

(url ? describe : describe.skip)('AddLocalization migration', () => {
  let client: Client;
  const runner = {
    query: (sql: string) => client.query(sql).then((result) => result.rows),
  } as unknown as QueryRunner;
  const rows = <T = Record<string, unknown>>(sql: string) =>
    client.query(sql).then((result) => result.rows as T[]);

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    // Fails loudly if the target database already has the app's schema.
    await client.query('CREATE SCHEMA "zielonykoszyk"');
    await client.query(`
      CREATE TABLE "zielonykoszyk"."products" (
        "product_id" SERIAL PRIMARY KEY, "name" character varying NOT NULL, "description" text NOT NULL,
        "price" numeric(10,2) NOT NULL, "category" character varying NOT NULL)`);
    await client.query(
      `CREATE TABLE "zielonykoszyk"."orders" ("order_id" SERIAL PRIMARY KEY)`,
    );
    await client.query(`
      CREATE TABLE "zielonykoszyk"."order_items" (
        "order_item_id" SERIAL PRIMARY KEY, "order_id" integer, "product_id" integer,
        "product_name" character varying NOT NULL, "quantity" integer NOT NULL, "price" numeric(10,2) NOT NULL)`);
    await client.query(`
      INSERT INTO "zielonykoszyk"."products" ("name", "description", "price", "category") VALUES
        ('Żurawina', 'Kwaśna żurawina z lasu', 9, 'owoce'),
        ('Banan', 'Pyszny i zdrowy banan', 6.5, 'owoce')`);
    await client.query(`INSERT INTO "zielonykoszyk"."orders" DEFAULT VALUES`);
    await client.query(`
      INSERT INTO "zielonykoszyk"."order_items" ("order_id", "product_id", "product_name", "quantity", "price") VALUES
        (1, 1, 'Żurawina', 1, 9), (1, NULL, 'Dostawa', 1, 10), (1, NULL, 'Dostawa', 1, 10)`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('moves every product text into pl translations, keeping ids and shared fields', async () => {
    await new AddLocalization1788700000000().up(runner);

    expect(
      await rows(
        `SELECT product_id, locale, name, description FROM "zielonykoszyk"."product_translations" ORDER BY product_id`,
      ),
    ).toEqual([
      {
        product_id: 1,
        locale: 'pl',
        name: 'Żurawina',
        description: 'Kwaśna żurawina z lasu',
      },
      {
        product_id: 2,
        locale: 'pl',
        name: 'Banan',
        description: 'Pyszny i zdrowy banan',
      },
    ]);
    expect(
      await rows(
        `SELECT product_id, category FROM "zielonykoszyk"."products" ORDER BY product_id`,
      ),
    ).toEqual([
      { product_id: 1, category: 'owoce' },
      { product_id: 2, category: 'owoce' },
    ]);
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'zielonykoszyk' AND table_name = 'products'`,
    );
    expect(columns.map((c) => c.column_name)).not.toContain('name');
  });

  it('enforces one translation per product and locale', async () => {
    await client.query('SAVEPOINT dup');
    await expect(
      client.query(
        `INSERT INTO "zielonykoszyk"."product_translations" VALUES (1, 'pl', 'Duplicate', 'x')`,
      ),
    ).rejects.toThrow(/duplicate key/);
    await client.query('ROLLBACK TO SAVEPOINT dup');
    await client.query(
      `INSERT INTO "zielonykoszyk"."product_translations" VALUES (1, 'en', 'Cranberry', 'Tart cranberry')`,
    );
  });

  it('defaults existing orders to pl and types delivery lines by their legacy name', async () => {
    expect(await rows(`SELECT locale FROM "zielonykoszyk"."orders"`)).toEqual([
      { locale: 'pl' },
    ]);
    expect(
      await rows(
        `SELECT product_name, item_type FROM "zielonykoszyk"."order_items" ORDER BY order_item_id`,
      ),
    ).toEqual([
      { product_name: 'Żurawina', item_type: 'PRODUCT' },
      { product_name: 'Dostawa', item_type: 'DELIVERY' },
      { product_name: 'Dostawa', item_type: 'DELIVERY' },
    ]);
  });

  it('reverts, restoring the Polish text on the products table', async () => {
    await new AddLocalization1788700000000().down(runner);

    expect(
      await rows(
        `SELECT product_id, name, description FROM "zielonykoszyk"."products" ORDER BY product_id`,
      ),
    ).toEqual([
      {
        product_id: 1,
        name: 'Żurawina',
        description: 'Kwaśna żurawina z lasu',
      },
      { product_id: 2, name: 'Banan', description: 'Pyszny i zdrowy banan' },
    ]);
    expect(
      await rows(
        `SELECT to_regclass('zielonykoszyk.product_translations') AS t`,
      ),
    ).toEqual([{ t: null }]);
  });
});
