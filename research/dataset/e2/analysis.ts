import { readFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { MfaMethod } from '../../../src/enums/MfaMethod';
import {
  atomicJson,
  atomicWrite,
  assertApprovedProtocol,
  createTopLevelArtifact,
  sealDirectory,
  sha256File,
  verifySha256Manifest,
} from './artifacts';
import {
  CLIENTS,
  E2_VARIANTS,
  E2Variant,
  HarnessError,
  MEASURED_BURSTS,
  MEASURED_ROUNDS,
  MEASURED_SAMPLES_PER_VARIANT,
  MEASURED_SCHEDULE,
  parseJtl,
  validateJtl,
} from './protocol';

const finite = (values: number[]) =>
  values.length > 0 && values.every((value) => Number.isFinite(value));

export const quantileHf7 = (values: number[], probability: number) => {
  if (!finite(values) || probability < 0 || probability > 1) {
    throw new HarnessError('ANALYSIS_QUANTILE_INPUT');
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const h = 1 + (sorted.length - 1) * probability;
  const lower = Math.floor(h);
  const fraction = h - lower;
  const left = sorted[lower - 1];
  const right = sorted[Math.min(lower, sorted.length - 1)];
  return (1 - fraction) * left + fraction * right;
};

export const sampleStandardDeviation = (values: number[]) => {
  if (!finite(values) || values.length < 2) {
    throw new HarnessError('ANALYSIS_SD_INPUT');
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
};

export const describe = (values: number[]) => {
  if (!finite(values) || values.length < 2) {
    throw new HarnessError('ANALYSIS_DESCRIPTIVE_INPUT');
  }
  const q1 = quantileHf7(values, 0.25);
  const q3 = quantileHf7(values, 0.75);
  return {
    n: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: quantileHf7(values, 0.5),
    p95: quantileHf7(values, 0.95),
    p99: quantileHf7(values, 0.99),
    sample_sd: sampleStandardDeviation(values),
    q1,
    q3,
    iqr: q3 - q1,
  };
};

const combinations = (n: number, k: number) => {
  const count = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= count; index += 1) {
    value = (value * (n - count + index)) / index;
  }
  return value;
};

export const exactPairedSignTest = (differences: number[]) => {
  if (!finite(differences)) throw new HarnessError('ANALYSIS_SIGN_INPUT');
  const negative = differences.filter((value) => value < 0).length;
  const positive = differences.filter((value) => value > 0).length;
  const ties = differences.length - negative - positive;
  const n_eff = negative + positive;
  let p = 1;
  if (n_eff) {
    let numerator = 0;
    for (let index = negative; index <= n_eff; index += 1) {
      numerator += combinations(n_eff, index);
    }
    p = numerator / 2 ** n_eff;
  }
  return { negative, positive, ties, n_eff, p };
};

export type HolmInput = { name: string; p: number };

export const holmStepDown = (input: HolmInput[], alpha = 0.05) => {
  if (
    input.length !== 4 ||
    input.some(({ name, p }) => !name || !Number.isFinite(p) || p < 0 || p > 1)
  ) {
    throw new HarnessError('ANALYSIS_HOLM_INPUT');
  }
  const sorted = [...input].sort(
    (left, right) => left.p - right.p || left.name.localeCompare(right.name),
  );
  let stopped = false;
  let prefixMaximum = 0;
  const evaluated = sorted.map((entry, index) => {
    const multiplier = sorted.length - index;
    const threshold = alpha / multiplier;
    const reject = !stopped && entry.p <= threshold;
    if (!reject) stopped = true;
    prefixMaximum = Math.max(prefixMaximum, multiplier * entry.p);
    return {
      ...entry,
      threshold,
      adjusted_p: Math.min(1, prefixMaximum),
      reject,
    };
  });
  return input.map(({ name }) =>
    evaluated.find((entry) => entry.name === name),
  );
};

export type BurstAnalysisInput = {
  round: number;
  order_position: number;
  variant: E2Variant;
  elapsed: number[];
  labels: string[];
  cpu_per_request_usec: number;
  memory_peak_delta_bytes: number;
};

export type VariantRound = {
  round: number;
  order_position: number;
  variant: E2Variant;
  n: number;
  mean_T_verify_ms: number;
  median_T_verify_ms: number;
  p95_T_verify_ms: number;
  p99_T_verify_ms: number;
  std_T_verify_ms: number;
  iqr_T_verify_ms: number;
  cpu_per_request_usec: number;
  memory_peak_delta_bytes: number;
};

const COMPARISONS = [
  {
    name: 'median_WEBAUTHN_minus_EMAIL_OTP',
    metric: 'median_T_verify_ms' as const,
    comparator: MfaMethod.EMAIL_OTP,
  },
  {
    name: 'median_WEBAUTHN_minus_TOTP',
    metric: 'median_T_verify_ms' as const,
    comparator: MfaMethod.TOTP,
  },
  {
    name: 'p95_WEBAUTHN_minus_EMAIL_OTP',
    metric: 'p95_T_verify_ms' as const,
    comparator: MfaMethod.EMAIL_OTP,
  },
  {
    name: 'p95_WEBAUTHN_minus_TOTP',
    metric: 'p95_T_verify_ms' as const,
    comparator: MfaMethod.TOTP,
  },
] as const;

export const analyzeBursts = (bursts: BurstAnalysisInput[]) => {
  if (bursts.length !== MEASURED_BURSTS) {
    throw new HarnessError('ANALYSIS_BURST_COUNT');
  }
  const keys = new Set<string>();
  for (const burst of bursts) {
    const expected =
      MEASURED_SCHEDULE[burst.round - 1]?.[burst.order_position - 1];
    const key = `${burst.round}:${burst.order_position}`;
    if (
      expected !== burst.variant ||
      keys.has(key) ||
      burst.elapsed.length !== CLIENTS ||
      burst.labels.length !== CLIENTS ||
      !finite(burst.elapsed) ||
      !Number.isFinite(burst.cpu_per_request_usec) ||
      !Number.isSafeInteger(burst.memory_peak_delta_bytes) ||
      burst.memory_peak_delta_bytes < 0
    ) {
      throw new HarnessError('ANALYSIS_BURST_INPUT');
    }
    keys.add(key);
  }
  const variantRound: VariantRound[] = bursts
    .map((burst) => {
      const stats = describe(burst.elapsed);
      return {
        round: burst.round,
        order_position: burst.order_position,
        variant: burst.variant,
        n: stats.n,
        mean_T_verify_ms: stats.mean,
        median_T_verify_ms: stats.median,
        p95_T_verify_ms: stats.p95,
        p99_T_verify_ms: stats.p99,
        std_T_verify_ms: stats.sample_sd,
        iqr_T_verify_ms: stats.iqr,
        cpu_per_request_usec: burst.cpu_per_request_usec,
        memory_peak_delta_bytes: burst.memory_peak_delta_bytes,
      };
    })
    .sort(
      (left, right) =>
        left.round - right.round || left.order_position - right.order_position,
    );
  const descriptive = E2_VARIANTS.map((variant) => {
    const values = bursts
      .filter((burst) => burst.variant === variant)
      .flatMap(({ elapsed }) => elapsed);
    if (values.length !== MEASURED_SAMPLES_PER_VARIANT) {
      throw new HarnessError('ANALYSIS_VARIANT_SAMPLE_COUNT');
    }
    return { variant, ...describe(values) };
  });
  const paired = COMPARISONS.map((comparison) => {
    const differences = Array.from({ length: MEASURED_ROUNDS }, (_, index) => {
      const round = index + 1;
      const webauthn = variantRound.find(
        (row) => row.round === round && row.variant === MfaMethod.WEBAUTHN,
      );
      const comparator = variantRound.find(
        (row) => row.round === round && row.variant === comparison.comparator,
      );
      if (!webauthn || !comparator) {
        throw new HarnessError('ANALYSIS_PAIRING');
      }
      return {
        round,
        difference: webauthn[comparison.metric] - comparator[comparison.metric],
      };
    });
    const values = differences.map(({ difference }) => difference);
    const signs = exactPairedSignTest(values);
    const effect = describe(values);
    return {
      name: comparison.name,
      comparator: comparison.comparator,
      metric: comparison.metric,
      differences,
      median: effect.median,
      q1: effect.q1,
      q3: effect.q3,
      iqr: effect.iqr,
      min: effect.min,
      max: effect.max,
      ...signs,
    };
  });
  const holm = holmStepDown(paired.map(({ name, p }) => ({ name, p })));
  const comparisons = paired.map((comparison) => ({
    ...comparison,
    adjusted_p: holm.find(({ name }) => name === comparison.name).adjusted_p,
    holm_threshold: holm.find(({ name }) => name === comparison.name).threshold,
    reject: holm.find(({ name }) => name === comparison.name).reject,
  }));
  return {
    descriptive,
    variantRound,
    comparisons,
    h2_supported: comparisons.every(
      ({ median, reject }) => median < 0 && reject,
    ),
  };
};

type IndexRow = {
  round: number;
  order_position: number;
  variant: E2Variant;
  run_path: string;
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

const parseIndex = (text: string): IndexRow[] => {
  const [header, ...lines] = text.trimEnd().split(/\r?\n/);
  if (header !== 'round,order_position,variant,run_path') {
    throw new HarnessError('ANALYSIS_INDEX_FIELDS');
  }
  return lines.filter(Boolean).map((line) => {
    const [roundText, positionText, variant, runPath, extra] = line.split(',');
    if (
      extra ||
      !E2_VARIANTS.includes(variant as E2Variant) ||
      !/^measured\/rounds\/round-\d{2}\/\d{2}-[a-z-]+$/.test(runPath)
    ) {
      throw new HarnessError('ANALYSIS_INDEX_ROW');
    }
    return {
      round: Number(roundText),
      order_position: Number(positionText),
      variant: variant as E2Variant,
      run_path: runPath,
    };
  });
};

export const loadValidCampaign = async (fullRoot: string) => {
  if (!basename(fullRoot).startsWith('e2-full-')) {
    throw new HarnessError('ANALYSIS_CAMPAIGN_ID');
  }
  await assertApprovedProtocol(resolve(fullRoot, 'E2.md'));
  const [status, progression, cleanup] = await Promise.all([
    readJson<{ status?: string }>(resolve(fullRoot, 'status.json')),
    readJson<{ status?: string }>(resolve(fullRoot, 'progression.json')),
    readJson<{ status?: string }>(resolve(fullRoot, 'cleanup.json')),
    readFile(resolve(fullRoot, 'state-after.json')),
  ]);
  if (
    status.status !== 'VALID' ||
    progression.status !== 'VALID' ||
    cleanup.status !== 'COMPLETE'
  ) {
    throw new HarnessError('ANALYSIS_CAMPAIGN_NOT_VALID');
  }
  await verifySha256Manifest(resolve(fullRoot, 'measured'));
  await verifySha256Manifest(fullRoot);
  const rows = parseIndex(
    await readFile(resolve(fullRoot, 'measured/index.csv'), 'utf8'),
  );
  if (rows.length !== MEASURED_BURSTS) {
    throw new HarnessError('ANALYSIS_INDEX_COUNT');
  }
  const root = resolve(fullRoot);
  const bursts = await Promise.all(
    rows.map(async (row): Promise<BurstAnalysisInput> => {
      const directory = resolve(fullRoot, row.run_path);
      if (!directory.startsWith(`${root}${sep}`)) {
        throw new HarnessError('ANALYSIS_INDEX_PATH');
      }
      const samples = parseJtl(
        await readFile(resolve(directory, 'jmeter.jtl'), 'utf8'),
      );
      validateJtl(samples, row.variant);
      const resources = await readJson<{
        cpu_per_request_usec: number;
        memory_peak_delta_bytes: number;
      }>(resolve(directory, 'resources.json'));
      return {
        round: row.round,
        order_position: row.order_position,
        variant: row.variant,
        elapsed: samples.map(({ elapsed }) => elapsed),
        labels: samples.map(({ label }) => label),
        cpu_per_request_usec: resources.cpu_per_request_usec,
        memory_peak_delta_bytes: resources.memory_peak_delta_bytes,
      };
    }),
  );
  return {
    experimentId: basename(fullRoot),
    measuredManifestSha256: await sha256File(
      resolve(fullRoot, 'measured/SHA256SUMS'),
    ),
    bursts,
  };
};

const csv = (header: string[], rows: Array<Array<string | number | boolean>>) =>
  [header.join(','), ...rows.map((row) => row.join(',')), ''].join('\n');

export const runAnalysis = async (input: {
  fullRoot: string;
  resultsRoot: string;
  protocolPath: string;
}) => {
  const campaign = await loadValidCampaign(input.fullRoot);
  const result = analyzeBursts(campaign.bursts);
  const analysisId = `e2-analysis-${campaign.experimentId}-${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}`;
  const root = await createTopLevelArtifact({
    resultsRoot: input.resultsRoot,
    kind: 'analysis',
    experimentId: analysisId,
    protocolPath: input.protocolPath,
  });
  await atomicJson(resolve(root, 'input.json'), {
    full_experiment_id: campaign.experimentId,
    measured_manifest_sha256: campaign.measuredManifestSha256,
    status_validated: true,
    state_after_validated: true,
    progression_validated: true,
  });
  await atomicWrite(
    resolve(root, 'raw-samples.csv'),
    csv(
      ['round', 'order_position', 'variant', 'client_slot', 'elapsed'],
      campaign.bursts.flatMap((burst) =>
        burst.elapsed.map((elapsed, index) => [
          burst.round,
          burst.order_position,
          burst.variant,
          burst.labels[index].slice(-3),
          elapsed,
        ]),
      ),
    ),
  );
  await atomicWrite(
    resolve(root, 'descriptive-by-variant.csv'),
    csv(
      [
        'variant',
        'n',
        'min',
        'max',
        'mean',
        'median',
        'p95',
        'p99',
        'sample_sd',
        'q1',
        'q3',
        'iqr',
      ],
      result.descriptive.map((row) => [
        row.variant,
        row.n,
        row.min,
        row.max,
        row.mean,
        row.median,
        row.p95,
        row.p99,
        row.sample_sd,
        row.q1,
        row.q3,
        row.iqr,
      ]),
    ),
  );
  await atomicWrite(
    resolve(root, 'variant-round.csv'),
    csv(
      [
        'round',
        'order_position',
        'variant',
        'n',
        'mean_T_verify_ms',
        'median_T_verify_ms',
        'p95_T_verify_ms',
        'p99_T_verify_ms',
        'std_T_verify_ms',
        'iqr_T_verify_ms',
        'cpu_per_request_usec',
        'memory_peak_delta_bytes',
      ],
      result.variantRound.map((row) => Object.values(row)),
    ),
  );
  await atomicWrite(
    resolve(root, 'paired-effects.csv'),
    csv(
      ['comparison', 'round', 'difference_ms'],
      result.comparisons.flatMap((comparison) =>
        comparison.differences.map(({ round, difference }) => [
          comparison.name,
          round,
          difference,
        ]),
      ),
    ),
  );
  await atomicWrite(
    resolve(root, 'sign-tests.csv'),
    csv(
      [
        'comparison',
        'median_difference',
        'q1',
        'q3',
        'iqr',
        'min',
        'max',
        'negative',
        'positive',
        'ties',
        'n_eff',
        'raw_p',
        'holm_adjusted_p',
        'holm_threshold',
        'reject',
      ],
      result.comparisons.map((row) => [
        row.name,
        row.median,
        row.q1,
        row.q3,
        row.iqr,
        row.min,
        row.max,
        row.negative,
        row.positive,
        row.ties,
        row.n_eff,
        row.p,
        row.adjusted_p,
        row.holm_threshold,
        row.reject,
      ]),
    ),
  );
  await atomicWrite(
    resolve(root, 'report.md'),
    `# E2 analysis\n\nFull H2 supported: ${result.h2_supported ? 'YES' : 'NO'}\n\nInference uses 12 paired rounds, exact one-sided sign tests, and Holm correction across four frozen comparisons. All 600 samples per variant are descriptive; no outliers were removed.\n`,
  );
  await sealDirectory(root);
  return root;
};
