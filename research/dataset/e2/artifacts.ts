import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import {
  APPROVED_PROTOCOL_SHA256,
  E2Variant,
  HarnessError,
  PROTOCOL_ID,
} from './protocol';
import { scanTextForSecrets } from './security';

export type ArtifactKind = 'preflight' | 'pilot' | 'full' | 'analysis';

export const sha256 = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

export const sha256File = async (path: string) => sha256(await readFile(path));

export const assertApprovedProtocol = async (path: string) => {
  if ((await sha256File(path)) !== APPROVED_PROTOCOL_SHA256) {
    throw new HarnessError('PROTOCOL_SHA_MISMATCH');
  }
};

export const createExclusiveDirectory = async (path: string) => {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path);
};

export const atomicWrite = async (
  path: string,
  value: string | Buffer,
  mode = 0o644,
) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(value);
    await handle.sync();
    await link(temporary, path);
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
};

export const atomicReplacePrivate = async (
  path: string,
  value: string | Buffer,
) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const atomicJson = (path: string, value: unknown, mode = 0o644) =>
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, mode);

const safeName = (value: string) => /^[a-z0-9][a-z0-9._-]*$/i.test(value);

export const createTopLevelArtifact = async (input: {
  resultsRoot: string;
  kind: ArtifactKind;
  experimentId: string;
  protocolPath: string;
}) => {
  if (
    !safeName(input.experimentId) ||
    !input.experimentId.startsWith(`e2-${input.kind}-`)
  ) {
    throw new HarnessError('ARTIFACT_EXPERIMENT_ID');
  }
  await assertApprovedProtocol(input.protocolPath);
  const root = resolve(input.resultsRoot, input.experimentId);
  if (!root.startsWith(`${resolve(input.resultsRoot)}${sep}`)) {
    throw new HarnessError('ARTIFACT_PATH');
  }
  await createExclusiveDirectory(root);
  await atomicWrite(resolve(root, 'E2.md'), await readFile(input.protocolPath));
  await atomicJson(resolve(root, 'protocol.json'), {
    protocol_id: PROTOCOL_ID,
    protocol_sha256: APPROVED_PROTOCOL_SHA256,
  });
  return root;
};

export const burstPath = (
  stage: 'pilot' | 'warmup' | 'measured',
  variant: E2Variant,
  orderPosition: number,
  round?: number,
) => {
  const slug = variant.toLowerCase().replace('_', '-');
  const name = `${String(orderPosition).padStart(2, '0')}-${slug}`;
  if (stage === 'measured') {
    if (!Number.isInteger(round) || round < 1 || round > 12) {
      throw new HarnessError('ARTIFACT_ROUND');
    }
    return `measured/rounds/round-${String(round).padStart(2, '0')}/${name}`;
  }
  return `${stage}/${name}`;
};

export const filesUnder = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const scanMemoryCsv = (text: string, exactSecrets: string[]) => {
  const schemaFailure = () =>
    [
      ...new Set([
        'ARTIFACT_SCHEMA',
        ...scanTextForSecrets(text, exactSecrets),
      ]),
    ].sort();
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== 'timestamp_utc,memory_current_bytes') {
    return schemaFailure();
  }
  const timestamps: string[] = [];
  for (const line of lines) {
    const [timestamp, memory, extra] = line.split(',');
    let canonicalTimestamp = false;
    try {
      canonicalTimestamp = new Date(timestamp).toISOString() === timestamp;
    } catch {
      // Invalid dates are rejected below.
    }
    if (
      extra !== undefined ||
      !canonicalTimestamp ||
      !/^(?:0|[1-9]\d*)$/.test(memory) ||
      !Number.isSafeInteger(Number(memory))
    ) {
      return schemaFailure();
    }
    timestamps.push(timestamp);
  }
  const otpSecrets = exactSecrets.filter((secret) => /^\d{6}$/.test(secret));
  return [
    ...new Set([
      ...scanTextForSecrets(
        text,
        exactSecrets.filter((secret) => !/^\d{6}$/.test(secret)),
      ),
      ...scanTextForSecrets(timestamps.join('\n'), otpSecrets),
    ]),
  ].sort();
};

export const scanArtifactText = (
  relativePath: string,
  text: string,
  exactSecrets: string[],
) =>
  basename(relativePath) === 'memory.csv'
    ? scanMemoryCsv(text, exactSecrets)
    : scanTextForSecrets(text, exactSecrets);

export const scanArtifacts = async (root: string, exactSecrets: string[]) => {
  const incidents: Array<{ relative_path: string; codes: string[] }> = [];
  for (const path of await filesUnder(root)) {
    const name = relative(root, path);
    if (name === 'E2.md' || name.endsWith('/E2.md')) continue;
    const nameCodes = scanTextForSecrets(name, exactSecrets);
    const codes = [
      ...new Set([
        ...nameCodes,
        ...scanArtifactText(name, await readFile(path, 'utf8'), exactSecrets),
      ]),
    ].sort();
    if (!codes.length) continue;
    await unlink(path);
    incidents.push({
      relative_path:
        !nameCodes.length && /^[a-z0-9._/-]+$/i.test(name)
          ? name
          : 'REDACTED_PATH',
      codes,
    });
  }
  if (incidents.length) {
    const code = incidents.some(({ codes }) =>
      codes.includes('ARTIFACT_SCHEMA'),
    )
      ? 'ARTIFACT_SCHEMA'
      : 'ARTIFACT_SECRET_SCAN';
    await atomicJson(resolve(root, 'incident.json'), {
      status: 'INVALID',
      code,
      incidents,
    });
    throw new HarnessError(code);
  }
};

const manifestEntries = async (directory: string) => {
  const files = (await filesUnder(directory))
    .filter((path) => relative(directory, path) !== 'SHA256SUMS')
    .sort((left, right) =>
      relative(directory, left).localeCompare(relative(directory, right)),
    );
  return Promise.all(
    files.map(async (path) => ({
      path,
      relativePath: relative(directory, path),
      hash: await sha256File(path),
    })),
  );
};

export const writeSha256Manifest = async (directory: string) => {
  const entries = await manifestEntries(directory);
  await atomicWrite(
    resolve(directory, 'SHA256SUMS'),
    `${entries.map(({ hash, relativePath }) => `${hash}  ${relativePath}`).join('\n')}\n`,
  );
  return entries;
};

export const verifySha256Manifest = async (directory: string) => {
  const manifestPath = resolve(directory, 'SHA256SUMS');
  const lines = (await readFile(manifestPath, 'utf8')).trimEnd().split('\n');
  const listed = new Map<string, string>();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([a-zA-Z0-9._/-]+)$/.exec(line);
    if (!match || listed.has(match[2]) || match[2].includes('..')) {
      throw new HarnessError('ARTIFACT_MANIFEST_FORMAT');
    }
    listed.set(match[2], match[1]);
  }
  const actual = await manifestEntries(directory);
  if (
    listed.size !== actual.length ||
    actual.some(({ relativePath, hash }) => listed.get(relativePath) !== hash)
  ) {
    throw new HarnessError('ARTIFACT_MANIFEST_MISMATCH');
  }
  return sha256File(manifestPath);
};

export const sealDirectory = async (
  directory: string,
  exactSecrets: string[] = [],
) => {
  await scanArtifacts(directory, exactSecrets);
  await writeSha256Manifest(directory);
  const files = await filesUnder(directory);
  await Promise.all(files.map((path) => chmod(path, 0o444)));
  const directories: string[] = [];
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const child = resolve(path, entry.name);
        await visit(child);
        directories.push(child);
      }
    }
  };
  await visit(directory);
  await Promise.all(directories.map((path) => chmod(path, 0o555)));
  await chmod(directory, 0o555);
};
