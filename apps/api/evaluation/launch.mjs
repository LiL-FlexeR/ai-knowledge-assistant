import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initialReport,
  offlineConfig,
  reportSchema,
  validateLiveConfig,
} from './core.mjs';

const mode = process.argv[2];
if (!['offline', 'live'].includes(mode))
  throw new Error('Expected offline or live.');
const reportPath = fileURLToPath(
  new URL(`./results/${mode}-latest.json`, import.meta.url),
);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
let report = initialReport(mode);
const save = () =>
  writeFileSync(
    reportPath,
    JSON.stringify(reportSchema.parse(report), null, 2) + '\n',
  );
try {
  if (mode === 'live') {
    if (process.env.AKA_EVAL_ALLOW_PAID !== 'yes')
      throw new Error('PAID_OPT_IN_REQUIRED');
    if (!process.env.OPENAI_API_KEY?.trim())
      throw new Error('CREDENTIALS_UNAVAILABLE');
    if (!process.env.AKA_EVAL_CONFIG)
      throw new Error('EXPLICIT_CONFIG_REQUIRED');
    report.config = validateLiveConfig(
      JSON.parse(readFileSync(process.env.AKA_EVAL_CONFIG, 'utf8')),
    );
  } else report.config = offlineConfig;
  save();
  const result = spawnSync(
    process.execPath,
    ['scripts/test-integration.mjs', `--eval-${mode}`],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: {
        ...process.env,
        AKA_EVAL_REPORT: reportPath,
        AKA_EVAL_VALIDATED_CONFIG: JSON.stringify(report.config),
      },
      stdio: 'inherit',
    },
  );
  report = reportSchema.parse(JSON.parse(readFileSync(reportPath, 'utf8')));
  if (result.status !== 0 || report.status === 'running') {
    report.status = 'terminated';
    report.reason ??= 'SETUP_OR_CHECK_FAILED';
    process.exitCode = 1;
  }
} catch (error) {
  report.status = 'not_run';
  report.reason = [
    'PAID_OPT_IN_REQUIRED',
    'CREDENTIALS_UNAVAILABLE',
    'EXPLICIT_CONFIG_REQUIRED',
    'PRICING_REVIEW_REQUIRED',
  ].includes(error.message)
    ? error.message
    : 'CONFIG_OR_REPORT_INVALID';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    `Evaluation ${mode}: ${report.status} (${report.reason ?? 'complete'}). Report: ${reportPath}`,
  );
}
