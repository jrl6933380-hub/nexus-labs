import { runNexTrials } from '../lib/nexTrials.js';

const report = runNexTrials();
console.log(`Nex Trials v${report.version}: ${report.passed}/${report.total} passed (${report.score}%)`);
for (const [category, score] of Object.entries(report.categories)) {
  console.log(`- ${category}: ${score.passed}/${score.total}`);
}
for (const trial of report.results.filter((item) => !item.passed)) {
  console.error(`FAIL ${trial.id}: ${trial.detail}`);
}
if (report.failed > 0) process.exitCode = 1;
