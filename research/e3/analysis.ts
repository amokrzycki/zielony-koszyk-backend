import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { readJson } from '../dataset';
import {
  createArtifactDirectory,
  sealArtifact,
  verifyArtifact,
  writeExclusive,
  writeJsonExclusive,
} from './artifacts';
import {
  BACKEND_ROOT,
  FRONTEND_ROOT,
  PROTOCOL_PATH,
  RESULTS_ROOT,
  gitClean,
  gitRevision,
} from './preflight';
import {
  FRONTEND_AFTER_COMMIT,
  MEASURED_BLOCKS,
  OrderEntry,
  SCENARIOS,
  Scenario,
  frozenBackendCommit,
  generateMeasuredOrder,
  nearestRank,
  protocolSha256,
  sha256,
} from './protocol';

type RunData = {
  run_id: string;
  block: number;
  position_in_block: number;
  scenario: Scenario;
  lcp_ms: number | null;
  inp_ms: number | null;
  cls_value: number;
  valid: boolean;
  invalid_reason: string | null;
};

type MetricKey = 'lcp_ms' | 'inp_ms' | 'cls_value';

export type MetricStats = {
  n_valid: number;
  n_invalid: number;
  q1: number;
  median: number;
  p75: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
};

export type ScenarioSummary = {
  status: 'ANALYZABLE' | 'INVALID';
  planned: number;
  n_valid: number;
  n_invalid: number;
  invalid_reasons: Record<string, number>;
  metrics: Record<MetricKey, MetricStats | null>;
};

const METRICS = [
  { key: 'lcp_ms', label: 'LCP (ms)', good: 2_500, poor: 4_000 },
  { key: 'inp_ms', label: 'INP (ms)', good: 200, poor: 500 },
  { key: 'cls_value', label: 'CLS', good: 0.1, poor: 0.25 },
] as const;

const assertValue = (condition: unknown, code: string) => {
  if (!condition) throw new Error(code);
};

export const summarizeValues = (
  values: readonly number[],
  nInvalid: number,
): MetricStats | null => {
  if (!values.length) return null;
  const q1 = nearestRank(values, 0.25);
  const q3 = nearestRank(values, 0.75);
  return {
    n_valid: values.length,
    n_invalid: nInvalid,
    q1,
    median: nearestRank(values, 0.5),
    p75: q3,
    q3,
    iqr: q3 - q1,
    min: Math.min(...values),
    max: Math.max(...values),
  };
};

export const evaluateH4 = (summaries: Record<Scenario, ScenarioSummary>) => {
  if (SCENARIOS.some((scenario) => summaries[scenario].status === 'INVALID')) {
    return { decision: 'BLOCKED' as const, criterion: 'threshold-only' };
  }
  const passes = Object.fromEntries(
    SCENARIOS.map((scenario) => [
      scenario,
      Object.fromEntries(
        METRICS.map(({ key, poor }) => [
          key,
          (summaries[scenario].metrics[key]?.p75 ?? Number.POSITIVE_INFINITY) <=
            poor,
        ]),
      ),
    ]),
  ) as Record<Scenario, Record<MetricKey, boolean>>;
  return {
    decision: SCENARIOS.every((scenario) =>
      METRICS.every(({ key }) => passes[scenario][key]),
    )
      ? ('CONFIRMED' as const)
      : ('REJECTED' as const),
    criterion: 'threshold-only' as const,
    thresholds: { lcp_ms: 4_000, inp_ms: 500, cls_value: 0.25 },
    passes,
  };
};

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csv = (rows: readonly Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  return `${[
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(','),
    ),
  ].join('\n')}\n`;
};

const scenarioLabel = (scenario: Scenario) => scenario.slice(0, 2);

const boxPlot = (
  metric: (typeof METRICS)[number],
  summaries: Record<Scenario, ScenarioSummary>,
) => {
  const width = 960;
  const height = 540;
  const top = 50;
  const bottom = 470;
  const values = SCENARIOS.flatMap((scenario) => {
    const stats = summaries[scenario].metrics[metric.key];
    return stats ? [stats.max] : [];
  });
  const ceiling = Math.max(metric.poor * 1.15, ...values) || 1;
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const lines = SCENARIOS.map((scenario, index) => {
    const stats = summaries[scenario].metrics[metric.key];
    if (!stats) return '';
    const x = 150 + index * 165;
    return `<line x1="${x}" y1="${y(stats.min)}" x2="${x}" y2="${y(stats.max)}" stroke="#334155"/><line x1="${x - 18}" y1="${y(stats.min)}" x2="${x + 18}" y2="${y(stats.min)}" stroke="#334155"/><line x1="${x - 18}" y1="${y(stats.max)}" x2="${x + 18}" y2="${y(stats.max)}" stroke="#334155"/><rect x="${x - 45}" y="${y(stats.q3)}" width="90" height="${Math.max(1, y(stats.q1) - y(stats.q3))}" fill="#bfdbfe" stroke="#1d4ed8"/><line x1="${x - 45}" y1="${y(stats.median)}" x2="${x + 45}" y2="${y(stats.median)}" stroke="#1e3a8a" stroke-width="3"/><text x="${x}" y="505" text-anchor="middle">${scenarioLabel(scenario)}</text>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:system-ui,sans-serif;font-size:14px;fill:#0f172a}</style><text x="30" y="30" font-size="20">${metric.label} distribution</text><line x1="90" y1="${y(metric.good)}" x2="930" y2="${y(metric.good)}" stroke="#16a34a" stroke-dasharray="7 5"/><text x="92" y="${y(metric.good) - 7}">Good ${metric.good}</text><line x1="90" y1="${y(metric.poor)}" x2="930" y2="${y(metric.poor)}" stroke="#dc2626" stroke-dasharray="7 5"/><text x="92" y="${y(metric.poor) - 7}">Poor ${metric.poor}</text><line x1="90" y1="${bottom}" x2="930" y2="${bottom}" stroke="#0f172a"/>${lines}</svg>\n`;
};

const normalizedPlot = (summaries: Record<Scenario, ScenarioSummary>) => {
  const width = 1_120;
  const height = 560;
  const bottom = 480;
  const values = METRICS.flatMap(({ key, poor }) =>
    SCENARIOS.map(
      (scenario) => ((summaries[scenario].metrics[key]?.p75 ?? 0) / poor) * 100,
    ),
  );
  const ceiling = Math.max(120, ...values.map((value) => value * 1.1));
  const y = (value: number) => bottom - (value / ceiling) * 410;
  let index = 0;
  const bars = METRICS.flatMap(({ key, label, poor }) =>
    SCENARIOS.map((scenario) => {
      const value = ((summaries[scenario].metrics[key]?.p75 ?? 0) / poor) * 100;
      const x = 80 + index++ * 66;
      return `<rect x="${x}" y="${y(value)}" width="42" height="${bottom - y(value)}" fill="#60a5fa"/><text x="${x + 21}" y="505" text-anchor="middle">${scenarioLabel(scenario)}</text><text x="${x + 21}" y="${Math.max(55, y(value) - 6)}" text-anchor="middle">${value.toFixed(1)}%</text><text x="${x + 21}" y="535" text-anchor="middle" font-size="11">${label.slice(0, 3)}</text>`;
    }),
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:system-ui,sans-serif;font-size:13px;fill:#0f172a}</style><text x="30" y="30" font-size="20">p75 as % of Poor threshold</text><line x1="55" y1="${y(100)}" x2="1080" y2="${y(100)}" stroke="#dc2626" stroke-width="2" stroke-dasharray="7 5"/><text x="58" y="${y(100) - 7}">100%</text><line x1="55" y1="${bottom}" x2="1080" y2="${bottom}" stroke="#0f172a"/>${bars}</svg>\n`;
};

const main = async () => {
  const fullPath = process.argv[2];
  assertValue(Boolean(fullPath), 'FULL_ARTIFACT_REQUIRED');
  const full = resolve(fullPath);
  assertValue(full.startsWith(`${RESULTS_ROOT}${sep}`), 'FULL_ARTIFACT_PATH');
  assertValue(/^e3-full-/.test(basename(full)), 'FULL_ARTIFACT_PATH');
  const fullManifestHash = await verifyArtifact(full);
  const [status, protocol, environment, order, indexText, protocolText] =
    await Promise.all([
      readJson<{
        status: string;
        error_code: string | null;
        total: {
          planned: number;
          completed: number;
          valid: number;
          invalid: number;
        };
        measured_completed: boolean;
      }>(resolve(full, 'status.json')),
      readJson<Record<string, unknown>>(resolve(full, 'protocol.json')),
      readJson<Record<string, unknown>>(resolve(full, 'environment.json')),
      readJson<OrderEntry[]>(resolve(full, 'order-manifest.json')),
      readFile(resolve(full, 'measured', 'index.csv'), 'utf8'),
      readFile(PROTOCOL_PATH, 'utf8'),
    ]);
  assertValue(
    status.total.planned === 105 &&
      status.total.completed === 105 &&
      status.measured_completed,
    'INCOMPLETE_CAMPAIGN',
  );
  assertValue(order.length === 105, 'FROZEN_ORDER_VIOLATION');
  assertValue(
    JSON.stringify(order) === JSON.stringify(generateMeasuredOrder()),
    'FROZEN_ORDER_VIOLATION',
  );
  assertValue(
    protocol.order_manifest_sha256 ===
      sha256(await readFile(resolve(full, 'order-manifest.json'))),
    'FROZEN_ORDER_VIOLATION',
  );
  assertValue(
    protocol.protocol_sha256 === (await protocolSha256(PROTOCOL_PATH)),
    'PROTOCOL_HASH_MISMATCH',
  );
  assertValue(await gitClean(FRONTEND_ROOT), 'ENVIRONMENT_MISMATCH');
  assertValue(await gitClean(BACKEND_ROOT), 'ENVIRONMENT_MISMATCH');
  assertValue(
    (await gitRevision(FRONTEND_ROOT)) === FRONTEND_AFTER_COMMIT,
    'ENVIRONMENT_MISMATCH',
  );
  assertValue(
    (await gitRevision(BACKEND_ROOT)) === frozenBackendCommit(protocolText),
    'ENVIRONMENT_MISMATCH',
  );
  assertValue(
    indexText.trimEnd().split('\n').length === 106,
    'INCOMPLETE_CAMPAIGN',
  );

  const runs: RunData[] = [];
  for (let block = 0; block < MEASURED_BLOCKS; block += 1) {
    const round = resolve(
      full,
      'measured',
      'rounds',
      `round-${String(block).padStart(2, '0')}`,
    );
    const names = (await readdir(round)).sort();
    assertValue(
      names.length === SCENARIOS.length &&
        SCENARIOS.every((scenario) => names.includes(`${scenario}.json`)),
      'INCOMPLETE_CAMPAIGN',
    );
  }
  for (const entry of order) {
    const run = await readJson<RunData>(
      resolve(
        full,
        'measured',
        'rounds',
        `round-${String(entry.block).padStart(2, '0')}`,
        `${entry.scenario}.json`,
      ),
    );
    assertValue(
      run.block === entry.block &&
        run.position_in_block === entry.position_in_block &&
        run.scenario === entry.scenario,
      'FROZEN_ORDER_VIOLATION',
    );
    runs.push(run);
  }
  assertValue(
    new Set(runs.map(({ run_id }) => run_id)).size === 105,
    'INCOMPLETE_CAMPAIGN',
  );
  assertValue(
    runs
      .filter(({ valid }) => valid)
      .every(
        ({ lcp_ms, inp_ms, cls_value }) =>
          lcp_ms !== null &&
          Number.isFinite(lcp_ms) &&
          inp_ms !== null &&
          Number.isFinite(inp_ms) &&
          Number.isFinite(cls_value),
      ),
    'INVALID_METRICS',
  );
  assertValue(
    runs.filter(({ valid }) => valid).length === status.total.valid &&
      runs.filter(({ valid }) => !valid).length === status.total.invalid,
    'CAMPAIGN_STATUS_MISMATCH',
  );

  const summaries = Object.fromEntries(
    SCENARIOS.map((scenario) => {
      const scenarioRuns = runs.filter((run) => run.scenario === scenario);
      assertValue(
        scenarioRuns.length === MEASURED_BLOCKS,
        'INCOMPLETE_CAMPAIGN',
      );
      const validRuns = scenarioRuns.filter((run) => run.valid);
      const invalidRuns = scenarioRuns.filter((run) => !run.valid);
      const invalidReasons: Record<string, number> = {};
      for (const { invalid_reason: reason } of invalidRuns) {
        const key = reason ?? 'UNKNOWN';
        invalidReasons[key] = (invalidReasons[key] ?? 0) + 1;
      }
      return [
        scenario,
        {
          status: invalidRuns.length >= 3 ? 'INVALID' : 'ANALYZABLE',
          planned: scenarioRuns.length,
          n_valid: validRuns.length,
          n_invalid: invalidRuns.length,
          invalid_reasons: invalidReasons,
          metrics: Object.fromEntries(
            METRICS.map(({ key }) => [
              key,
              summarizeValues(
                validRuns
                  .map((run) => run[key])
                  .filter((value): value is number => value !== null),
                invalidRuns.length,
              ),
            ]),
          ),
        },
      ];
    }),
  ) as Record<Scenario, ScenarioSummary>;
  const h4 = evaluateH4(summaries);
  const comparisons = SCENARIOS.slice(1).flatMap((scenario) =>
    METRICS.map(({ key }) => {
      const before = summaries.S0_BEFORE_MFA.metrics[key]?.p75 ?? null;
      const after = summaries[scenario].metrics[key]?.p75 ?? null;
      const absolute =
        before === null || after === null ? null : after - before;
      return {
        before: 'S0_BEFORE_MFA',
        after: scenario,
        metric: key,
        p75_before: before,
        p75_after: after,
        absolute_difference: absolute,
        relative_difference_percent:
          absolute === null || before === 0 ? null : (absolute / before) * 100,
      };
    }),
  );
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifact = await createArtifactDirectory(
    RESULTS_ROOT,
    `e3-analysis-${timestamp}`,
  );
  const summary = {
    experiment: 'E3',
    phase: 'analysis',
    status: 'PASS',
    source_artifact: basename(full),
    source_manifest_sha256: fullManifestHash,
    protocol_sha256: protocol.protocol_sha256,
    backend_commit: environment.backend_commit,
    statistical_method: 'nearest-rank without interpolation',
    campaign_status: status.status,
    campaign_error_code: status.error_code,
    completeness: status.total,
    scenarios: summaries,
    comparisons,
    h4,
    generated_at: new Date().toISOString(),
  };
  await writeJsonExclusive(resolve(artifact, 'summary.json'), summary);
  await writeExclusive(
    resolve(artifact, 'summary.csv'),
    csv(
      SCENARIOS.flatMap((scenario) =>
        METRICS.map(({ key }) => ({
          scenario,
          status: summaries[scenario].status,
          planned: summaries[scenario].planned,
          n_valid: summaries[scenario].n_valid,
          n_invalid: summaries[scenario].n_invalid,
          invalid_reasons: summaries[scenario].invalid_reasons,
          metric: key,
          ...summaries[scenario].metrics[key],
        })),
      ),
    ),
  );
  await writeExclusive(resolve(artifact, 'comparisons.csv'), csv(comparisons));
  for (const metric of METRICS) {
    await writeExclusive(
      resolve(artifact, 'plots', `${metric.key}-distribution.svg`),
      boxPlot(metric, summaries),
    );
  }
  await writeExclusive(
    resolve(artifact, 'plots', 'p75-normalized-to-poor.svg'),
    normalizedPlot(summaries),
  );
  const manifestHash = await sealArtifact(artifact);
  assertValue(
    (await verifyArtifact(artifact)) === manifestHash,
    'SHA256SUMS_FAILURE',
  );
  process.stdout.write(
    `${JSON.stringify({ artifact, manifest_sha256: manifestHash, status: 'PASS', h4: h4.decision })}\n`,
  );
};

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'E3_ANALYSIS_FATAL'}\n`,
    );
    process.exitCode = 1;
  });
}
