import { parseArgs } from "@std/cli";
import { parse } from "@std/yaml";
import {
  type CveIgnoreEntry,
  CveIgnoreEntrySchema,
  type TrivyReport,
  TrivyReportSchema,
  type TrivyResult,
  type Vulnerability,
} from "./schemas.ts";
import { z } from "zod";

try {
  // JS object!
  const args = parseArgs(Deno.args);
  console.log(`Script args ${JSON.stringify(args, null, 2)}`);

  Deno.statSync(args.trivyreport);
  console.log(`Parsing Trivy report ${args.trivyreport}`);

  const vulnerabilities = await parseReport(args.trivyreport);
  if (vulnerabilities.length === 0) {
    console.log("No vulnerabilities found");
    Deno.exit(0);
  }

  console.log(`Trivy found ${vulnerabilities.length}  vulnerabilities`);
  const results: CveEvalResult[] = await analyzeCVEs(vulnerabilities);

  const failures = results.filter((result) => result.error);

  if (failures.length === 0) {
    console.log(`No action needed on found CVEs`);
    Deno.exit(0);
  } else {
    console.log(`Found CVEs that require manual intervention: ${failures}`);
    Deno.exit(1);
  }
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Parsing error:", error.issues);
  }
  console.error(error);
  Deno.exit(1);
}

async function analyzeCVEs(
  vulnerabilities: Vulnerability[],
): Promise<CveEvalResult[]> {
  const results: CveEvalResult[] = [];

  for (const cve of vulnerabilities) {
    console.log(`Processing ${cve.VulnerabilityID}`);
    const result: CveEvalResult = await analyzeCVE(cve);

    console.log(`Result: ${JSON.stringify(result, null, 2)}`);

    results.push(result);
  }
  return results;
}

interface CveEvalResult {
  cve: string;
  error: string | null;
}

async function analyzeCVE(cve: Vulnerability): Promise<CveEvalResult> {
  const defaultResult: CveEvalResult = {
    cve: cve.VulnerabilityID,
    error: "Unknown CVE error. Requires manual investigation",
  };
  const cveIgnores: CveIgnoreEntry[] = await parseTrivyIgnore(
    "trivyignore.yaml",
  );

  if (!cve.FixedVersion) {
    return processCveWithoutFixedVersion(cve, cveIgnores);
  }

  // FixedVersion exists - check latest base image digest
  // if there is a new digest (a newer version has been pushed) - it might contain the CVE fix
  const latestDigest = getLatestBaseImageDigest()


  // CASE 1: we are already using the latest base image (digest is the same as in Dockerfile)
  // That means, we already analyzed Trivy scan results and CVE is part of the image
  // STEP1: check if trivyignore already contains it --> then no action needed
  // STEP2: try running apk upgrade on base image and scan with trivy again to see if this solves the problem
  // STEP3: if apk upgrade did solve the problem - also add the CVE to ignorelist to recognize the fix later and remove apk upgrade

/*   trivy image \
  --format json \
  nginxinc/nginx-unprivileged:stable-alpine3.25

  const vulnerabilities =
    report.Results.flatMap(r => r.Vulnerabilities ?? []);

const fixed = !vulnerabilities.some(
    v => v.VulnerabilityID === cve
); */

  // Case 1: Latest base image contains the fix


  // Case 2: Latest base image does not yet contain the fix - check trivyignore file

  // Case3: If trivyignore does not contain CVE - Try if apk upgrade on this image fixes the problem
  return defaultResult;
}

function getLatestBaseImageDigest(): string{
  const args = parseArgs(Deno.args)

  return ""
}



function processCveWithoutFixedVersion(
  cve: Vulnerability,
  cveIgnores: CveIgnoreEntry[],
): CveEvalResult {
  const cveIgnoreEntry: CveIgnoreEntry | null = cveInIgnoreList(cve, cveIgnores);

  const result: CveEvalResult = {
    cve: cve.VulnerabilityID,
    error: null,
  };
  if (cveIgnoreEntry) {
    const expired: boolean = cveIgnoreExpired(cveIgnoreEntry);
    result.error = expired
      ? "CVE needs manual investigation. It is in CVE ignore list, but expired"
      : null;
  } else {
    result.error =
      "CVE needs manual investigation. It is not in CVE ignore list, but has no fixed date either";
  }
  return result;
}

function cveIgnoreExpired(cveIgnore: CveIgnoreEntry): boolean {
  const [year, month, day] = cveIgnore.expired_at.split("-").map(Number);
  //JS uses 0 based months
  const expiredAt = new Date(year, month - 1, day);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (expiredAt > today) {
    console.log(
      `CVE ignore ${cveIgnore.id} is still valid, expires ${cveIgnore.expired_at}`,
    );
    return false;
  } else {
    console.log(`CVE ignore ${cveIgnore.id} expired ${cveIgnore.expired_at}`);
    return true;
  }
}

function cveInIgnoreList(
  cve: Vulnerability,
  ignoreList: CveIgnoreEntry[],
): CveIgnoreEntry | null {
  for (const ignore of ignoreList) {
    if (ignore.id === cve.VulnerabilityID) {
      console.log(
        `CVE ${cve.VulnerabilityID} found in Trivy ignore  list ${ignore}`,
      );

      return ignore;
    }
  }

  return null;
}
async function parseTrivyIgnore(filePath: string): Promise<CveIgnoreEntry[]> {
  const content = await Deno.readTextFile(filePath);

  const cveIgnores: CveIgnoreEntry[] = CveIgnoreEntrySchema.array().parse(
    parse(content),
  );

  console.log(`List of ignored CVEs from ${filePath}: ${cveIgnores}`);

  return cveIgnores ?? [];
}

async function parseReport(filePath: string): Promise<Vulnerability[]> {
  const rawContent = await Deno.readTextFile(filePath);

  // runtime and compile time schema check
  const report: TrivyReport = TrivyReportSchema.parse(JSON.parse(rawContent));

  const results: TrivyResult[] = report.Results;

  // Vulnerabilities may theoretically be missing in json
  const vulnerabilities: Vulnerability[] = results[0].Vulnerabilities ?? [];

  return vulnerabilities;
}

/* // Define a TypeScript interface for the API response
interface Todo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
}

// A simple function with explicit type annotations
function formatTodo(todo: Todo): string {
  return `[Todo #${todo.id}] ${todo.title} (Status: ${todo.completed ? "✅ Done" : "❌ Pending"})`;
}

try {
  console.log("Fetching data from API...");
  const response = await fetch("https://typicode.com");
  const data: Todo = await response.json();

  // Format the text output
  const formattedText = formatTodo(data);
  console.log("\nResult:\n" + formattedText);

  // Write the result to a text file using Deno's built-in file system API
  await Deno.writeTextFile("todo_output.txt", formattedText);
  console.log("\nSuccessfully saved output to todo_output.txt!");
} catch (error) {
  console.error("An error occurred:", error);
} */
