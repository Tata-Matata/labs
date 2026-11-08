import {
  type TrivyReport,
  TrivyReportSchema,
  type TrivyResult,
  type Vulnerability,
} from "./schemas.ts";


export async function parseReport(filePath: string): Promise<Vulnerability[]> {
  const exists = await Deno.statSync(filePath).isFile;

  if(!exists){
    throw new Error(`Failed to find Trivy report ${filePath}`)
  }

  console.log(`Parsing Trivy report ${filePath}`);

  const rawContent = await Deno.readTextFile(filePath);
  const jsonData = JSON.parse(rawContent);

  // runtime and compile time schema check
  const report: TrivyReport = TrivyReportSchema.parse(jsonData);

  const results: TrivyResult[] = report.Results;

  // Vulnerabilities may theoretically be missing in json
  const vulnerabilities: Vulnerability[] = results[0].Vulnerabilities ?? [];

  return vulnerabilities;
}
