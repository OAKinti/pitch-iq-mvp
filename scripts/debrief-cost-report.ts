// Usage: npx --yes tsx scripts/debrief-cost-report.ts <usage-log-file>
// Reads one local log export, prints aggregates only. Exit 0 report, 1 unreadable/no records, 2 no argument.
import { readFileSync } from 'node:fs';
import { parseUsageLogLine } from '../supabase/functions/_shared/usageTelemetry';
import type { DebriefUsageRecord } from '../supabase/functions/_shared/usageTelemetry';
import { renderCostReport, summarizeDebriefUsage } from '../src/services/voice/costReport';

function main(): number {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: debrief-cost-report <usage-log-file>');
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error('cannot read the log file');
    return 1;
  }
  const records: DebriefUsageRecord[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const rec = parseUsageLogLine(line);
    if (rec) records.push(rec);
    else skipped += 1;
  }
  const report = summarizeDebriefUsage(records);
  if (!report) {
    console.error('no valid usage records');
    return 1;
  }
  console.log(renderCostReport(report));
  console.log(`skipped: ${skipped}`);
  return 0;
}

process.exitCode = main();
