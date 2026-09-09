import { open, readFile, readdir, chmod, mkdir } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { InvalidReason, sha256 } from './protocol';

export type ExternalResource = {
  origin: string;
  host: string;
  initiator_type: string;
  duration: number | null;
  transfer_size: number | null;
  success: boolean;
};

export type RunArtifactInput = {
  run_id: string;
  block: number;
  position_in_block: number;
  scenario: string;
  frontend_variant: 'before' | 'after';
  account_slot: string;
  navigation_start_ts: string;
  lcp_ms: number | null;
  lcp_element_selector: string | null;
  inp_ms: number | null;
  inp_interaction_target: string | null;
  cls_value: number;
  cls_boundary_ts: number;
  measured_window_end_ts: string;
  valid: boolean;
  invalid_reason: InvalidReason | null;
  chromium_pid_started_fresh: boolean;
  duration_total_ms: number;
  external_resources: ExternalResource[];
  [key: string]: unknown;
};

const externalResource = (value: ExternalResource): ExternalResource => ({
  origin: value.origin,
  host: value.host,
  initiator_type: value.initiator_type,
  duration: value.duration,
  transfer_size: value.transfer_size,
  success: value.success,
});

export const serializeRun = (value: RunArtifactInput) => ({
  run_id: value.run_id,
  block: value.block,
  position_in_block: value.position_in_block,
  scenario: value.scenario,
  frontend_variant: value.frontend_variant,
  account_slot: value.account_slot,
  navigation_start_ts: value.navigation_start_ts,
  lcp_ms: value.lcp_ms,
  lcp_element_selector: value.lcp_element_selector,
  inp_ms: value.inp_ms,
  inp_interaction_target: value.inp_interaction_target,
  cls_value: value.cls_value,
  cls_boundary_ts: value.cls_boundary_ts,
  measured_window_end_ts: value.measured_window_end_ts,
  valid: value.valid,
  invalid_reason: value.invalid_reason,
  chromium_pid_started_fresh: value.chromium_pid_started_fresh,
  duration_total_ms: value.duration_total_ms,
  external_resources: value.external_resources.map(externalResource),
});

export const assertSecretSafe = (text: string, exactSecrets: string[] = []) => {
  if (
    exactSecrets.some((secret) => secret && text.includes(secret)) ||
    /"(?:password|otp|totp_secret|access_token|refresh_token|authorization|mfa_token|privateKey|cookies?)"\s*:/i.test(
      text,
    ) ||
    /Bearer\s+[A-Za-z0-9._~-]+/i.test(text) ||
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)
  ) {
    throw new Error('SECRET_LEAK');
  }
};

export const createArtifactDirectory = async (
  resultsRoot: string,
  experimentId: string,
) => {
  if (
    !/^e3-(?:(?:preflight|pilot|full)-[0-9TZ-]+-[0-9a-f]{8}-[0-9a-f]{8}|analysis-[0-9TZ-]+)$/.test(
      experimentId,
    )
  ) {
    throw new Error('ARTIFACT_ID');
  }
  const root = resolve(resultsRoot, experimentId);
  if (!root.startsWith(`${resolve(resultsRoot)}${sep}`)) {
    throw new Error('ARTIFACT_PATH');
  }
  await mkdir(resultsRoot, { recursive: true });
  await mkdir(root, { recursive: false });
  return root;
};

export const writeExclusive = async (
  path: string,
  value: string | Buffer,
  exactSecrets: string[] = [],
) => {
  if (typeof value === 'string') assertSecretSafe(value, exactSecrets);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx', 0o644);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const writeJsonExclusive = (
  path: string,
  value: unknown,
  exactSecrets: string[] = [],
) => writeExclusive(path, `${JSON.stringify(value, null, 2)}\n`, exactSecrets);

const filesUnder = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

export const sealArtifact = async (
  root: string,
  exactSecrets: string[] = [],
) => {
  const files = (await filesUnder(root)).sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right)),
  );
  const entries: string[] = [];
  for (const path of files) {
    const contents = await readFile(path);
    assertSecretSafe(contents.toString('utf8'), exactSecrets);
    entries.push(`${sha256(contents)}  ${relative(root, path)}`);
  }
  await writeExclusive(
    resolve(root, 'SHA256SUMS'),
    `${entries.join('\n')}\n`,
    exactSecrets,
  );
  for (const path of await filesUnder(root)) await chmod(path, 0o444);
  await chmod(root, 0o555);
  return sha256(await readFile(resolve(root, 'SHA256SUMS')));
};

export const verifyArtifact = async (root: string) => {
  const lines = (await readFile(resolve(root, 'SHA256SUMS'), 'utf8'))
    .trimEnd()
    .split('\n');
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([a-zA-Z0-9._/-]+)$/.exec(line);
    if (!match || basename(match[2]) === 'SHA256SUMS') {
      throw new Error('ARTIFACT_MANIFEST_FORMAT');
    }
    const path = resolve(root, match[2]);
    if (!path.startsWith(`${resolve(root)}${sep}`))
      throw new Error('ARTIFACT_PATH');
    if (sha256(await readFile(path)) !== match[1]) {
      throw new Error('ARTIFACT_MANIFEST_MISMATCH');
    }
  }
  return sha256(await readFile(resolve(root, 'SHA256SUMS')));
};
