import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Localization: product text moves to `product_translations` (one row per locale), orders remember the language they
 * were placed in, and order lines get a machine-facing type instead of being recognised by their Polish name.
 *
 * Existing catalog text is copied into `pl` rows *before* the old columns are dropped, so no content is lost.
 */
export class AddLocalization1788700000000 implements MigrationInterface {
  name = 'AddLocalization1788700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "zielonykoszyk"."locale_enum" AS ENUM ('pl', 'en')`,
    );
    await queryRunner.query(`
      CREATE TABLE "zielonykoszyk"."product_translations" (
        "product_id" integer NOT NULL,
        "locale" "zielonykoszyk"."locale_enum" NOT NULL,
        "name" character varying NOT NULL,
        "description" text NOT NULL,
        CONSTRAINT "PK_product_translations" PRIMARY KEY ("product_id", "locale"),
        CONSTRAINT "FK_product_translations_product" FOREIGN KEY ("product_id")
          REFERENCES "zielonykoszyk"."products"("product_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO "zielonykoszyk"."product_translations" ("product_id", "locale", "name", "description")
      SELECT "product_id", 'pl', "name", "description" FROM "zielonykoszyk"."products"
    `);
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" DROP COLUMN "name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" DROP COLUMN "description"`,
    );

    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."orders" ADD "locale" "zielonykoszyk"."locale_enum" NOT NULL DEFAULT 'pl'`,
    );

    await queryRunner.query(
      `CREATE TYPE "zielonykoszyk"."order_items_item_type_enum" AS ENUM ('PRODUCT', 'DELIVERY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."order_items" ADD "item_type" "zielonykoszyk"."order_items_item_type_enum" NOT NULL DEFAULT 'PRODUCT'`,
    );
    // One-off backfill: until now the shipping line was only identifiable by its Polish name.
    await queryRunner.query(`
      UPDATE "zielonykoszyk"."order_items" SET "item_type" = 'DELIVERY'
      WHERE "product_id" IS NULL AND "product_name" = 'Dostawa'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."order_items" DROP COLUMN "item_type"`,
    );
    await queryRunner.query(
      `DROP TYPE "zielonykoszyk"."order_items_item_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."orders" DROP COLUMN "locale"`,
    );

    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" ADD "name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" ADD "description" text`,
    );
    // Polish wins; a product that only has another language falls back to it. Other languages are dropped.
    await queryRunner.query(`
      UPDATE "zielonykoszyk"."products" p SET "name" = t."name", "description" = t."description"
      FROM (
        SELECT DISTINCT ON ("product_id") "product_id", "name", "description"
        FROM "zielonykoszyk"."product_translations"
        ORDER BY "product_id", ("locale" = 'pl') DESC
      ) t
      WHERE t."product_id" = p."product_id"
    `);
    await queryRunner.query(
      `UPDATE "zielonykoszyk"."products" SET "name" = '' WHERE "name" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "zielonykoszyk"."products" SET "description" = '' WHERE "description" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" ALTER COLUMN "name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."products" ALTER COLUMN "description" SET NOT NULL`,
    );
    await queryRunner.query(
      `DROP TABLE "zielonykoszyk"."product_translations"`,
    );
    await queryRunner.query(`DROP TYPE "zielonykoszyk"."locale_enum"`);
  }
}
