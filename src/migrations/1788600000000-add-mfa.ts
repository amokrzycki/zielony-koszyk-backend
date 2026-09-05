import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfa1788600000000 implements MigrationInterface {
  name = 'AddMfa1788600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "zielonykoszyk"."users_mfa_method_enum" AS ENUM ('NONE', 'EMAIL_OTP', 'TOTP', 'WEBAUTHN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "zielonykoszyk"."mfa_challenges_method_enum" AS ENUM ('EMAIL_OTP', 'TOTP', 'WEBAUTHN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "zielonykoszyk"."mfa_challenges_purpose_enum" AS ENUM ('LOGIN', 'ENROLLMENT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" ADD "mfa_method" "zielonykoszyk"."users_mfa_method_enum" NOT NULL DEFAULT 'NONE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" ADD "totp_secret_encrypted" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" ADD "totp_last_used_step" integer`,
    );
    await queryRunner.query(`
      CREATE TABLE "zielonykoszyk"."mfa_challenges" (
        "challenge_id" uuid NOT NULL,
        "user_id" character(36) NOT NULL,
        "method" "zielonykoszyk"."mfa_challenges_method_enum" NOT NULL,
        "purpose" "zielonykoszyk"."mfa_challenges_purpose_enum" NOT NULL,
        "otp_digest" character(64),
        "webauthn_challenge" character varying(255),
        "totp_secret_encrypted" text,
        "attempt_count" smallint NOT NULL DEFAULT 0,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_mfa_challenges" PRIMARY KEY ("challenge_id"),
        CONSTRAINT "UQ_mfa_challenges_user_purpose" UNIQUE ("user_id", "purpose"),
        CONSTRAINT "FK_mfa_challenges_user" FOREIGN KEY ("user_id")
          REFERENCES "zielonykoszyk"."users"("user_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "zielonykoszyk"."webauthn_credentials" (
        "credential_id" text NOT NULL,
        "user_id" character(36) NOT NULL,
        "public_key" bytea NOT NULL,
        "sign_count" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_webauthn_credentials" PRIMARY KEY ("credential_id"),
        CONSTRAINT "REL_cf9dd4c89545f22418bfcec368" UNIQUE ("user_id"),
        CONSTRAINT "FK_webauthn_credentials_user" FOREIGN KEY ("user_id")
          REFERENCES "zielonykoszyk"."users"("user_id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "zielonykoszyk"."webauthn_credentials"`,
    );
    await queryRunner.query(`DROP TABLE "zielonykoszyk"."mfa_challenges"`);
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" DROP COLUMN "totp_last_used_step"`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" DROP COLUMN "totp_secret_encrypted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "zielonykoszyk"."users" DROP COLUMN "mfa_method"`,
    );
    await queryRunner.query(
      `DROP TYPE "zielonykoszyk"."mfa_challenges_purpose_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "zielonykoszyk"."mfa_challenges_method_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "zielonykoszyk"."users_mfa_method_enum"`,
    );
  }
}
