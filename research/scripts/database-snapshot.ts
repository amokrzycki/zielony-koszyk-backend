import { spawn } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DATABASE_SNAPSHOT_PATH, requireEnvironment } from '../dataset';
import { connectDatabase, disconnectDatabase } from '../runtime';
import { validateDataset } from './validate-dataset';

const run = (command: string, args: string[], environment: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code ?? 'signal'}`)),
    );
  });

const postgresEnvironment = (connection: string) => {
  const url = new URL(connection);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !database) {
    throw new Error('Research database URL must target PostgreSQL explicitly');
  }
  return {
    database,
    environment: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      ...(url.searchParams.get('sslmode')
        ? { PGSSLMODE: url.searchParams.get('sslmode') }
        : {}),
    },
  };
};

export const createDatabaseSnapshot = async () => {
  const { DATABASE_URL } = requireEnvironment('DATABASE_URL');
  const { environment } = postgresEnvironment(DATABASE_URL);
  const temporaryPath = `${DATABASE_SNAPSHOT_PATH}.${process.pid}.tmp`;
  await mkdir(dirname(DATABASE_SNAPSHOT_PATH), {
    recursive: true,
    mode: 0o700,
  });
  const previousUmask = process.umask(0o077);
  try {
    await run(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--schema=zielonykoszyk',
        `--file=${temporaryPath}`,
      ],
      environment,
    );
    await rename(temporaryPath, DATABASE_SNAPSHOT_PATH);
  } finally {
    process.umask(previousUmask);
    await rm(temporaryPath, { force: true });
  }
  console.log(`Database snapshot created: ${DATABASE_SNAPSHOT_PATH}`);
};

export const restoreDatabaseSnapshot = async () => {
  if (!process.argv.includes('--yes')) {
    throw new Error('Restore refused; pass --yes');
  }
  const { MFA_RESEARCH_RESTORE_DATABASE_URL: target } = requireEnvironment(
    'MFA_RESEARCH_RESTORE_DATABASE_URL',
  );
  const { database, environment } = postgresEnvironment(target);
  await run(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--exit-on-error',
      `--dbname=${database}`,
      DATABASE_SNAPSHOT_PATH,
    ],
    environment,
  );
  console.log('Database snapshot restored to explicit research target');
};

const createValidatedSnapshot = async () => {
  requireEnvironment(
    'DATABASE_URL',
    'MFA_RESEARCH_PASSWORD',
    'RESEARCH_MAIL_DOMAIN',
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_ORIGIN',
  );
  try {
    await validateDataset(await connectDatabase());
  } finally {
    await disconnectDatabase();
  }
  await createDatabaseSnapshot();
};

if (require.main === module) {
  void (
    process.argv.includes('--restore')
      ? restoreDatabaseSnapshot()
      : createValidatedSnapshot()
  ).catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
