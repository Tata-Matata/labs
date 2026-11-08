import { parseArgs } from "@std/cli";
import { parse } from "@std/yaml";
import { parseReport } from "./trivy-parse-report.ts";
import {
  type CveIgnoreEntry,
  CveIgnoreEntrySchema,
  type DockerhubImage,
  DockerhubSchema,
  type GcrIoImage,
  GcrIoSchema,
  type TrivyReport,
  TrivyReportSchema,
  type Vulnerability,
} from "./schemas.ts";
import { z } from "zod";
import { error } from "node:console";

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
  const args = parseArgs(Deno.args);

  if (cve.FixedVersion) {
    // FixedVersion exists - check latest base image digest
    // if there is a new digest (a newer version has been pushed) - it might contain the CVE fix
    const latestDigest = await getLatestBaseImageDigest();
    const currentDigest = String(args.base_image).split("@")[1];

    // there is a newer digest; we are using an older one
    if (latestDigest !== currentDigest) {
      const latestImageWithDigest: string = String(args.base_image).replace(
        currentDigest,
        latestDigest,
      );
      return analyzeLatestDigest(latestImageWithDigest, cve);
    } 
  }

  // there is no FixedVersion yet or 
  // we are already using the latest digest in the pipeline and CVE is not fixed there
  return await checkCveInIgnoreList(cve);
}

async function analyzeLatestDigest(
  latestImageWithDigest: string,
  cve: Vulnerability,
): Promise<CveEvalResult> {

  const fixedInLatestDigest: boolean = await cveFixed( latestImageWithDigest, cve);

  //CVE fixed in latest digest
  if (fixedInLatestDigest) {
    return {
      cve: cve.VulnerabilityID,
      error:
        `Update base image to the latest digest ${latestImageWithDigest}. The CVE ${cve.VulnerabilityID} is fixed there`,
    };
  }

  // CVE still not fixed in newer digest and we are using older digest

  // CVE is known in ignore list
  const checkIgnoreList = await checkCveInIgnoreList(cve);
  if (checkIgnoreList.error == null) {
    console.log(
      `CVE ${cve.VulnerabilityID} is in ignore list. We are not using the newest digest, but it does not contain DVE fix yet`,
    );
    return checkIgnoreList;
  }

  // CVE is not in ignore list yet

  // return error with instructions to consider running apk upgrade on the latest image and/or adding CVE to ignore list
  return {
    cve: cve.VulnerabilityID,
    error:
      `The CVE ${cve.VulnerabilityID} is not fixed in latest image digest, and it can't be fixed by apk upgrade.
    Consider adding it to ignore list or testing apk upgrade using separate pipeline`,
  };
}

// deno run --allow-run=trivy script.ts
async function cveFixed(
  image: string,
  cve: Vulnerability,
): Promise<boolean> {
  const vulnerabilities: Vulnerability[] = await runTrivyScan(image);

  const fixed = !vulnerabilities.some((v) =>
    v.VulnerabilityID === cve.VulnerabilityID
  );

  if (fixed) {
    console.log(
      `CVE ${cve.VulnerabilityID} not found among vulnerabilities for image ${image}`,
    );
  } else {
    console.log(
      `CVE ${cve.VulnerabilityID} is in the list of vulnerabilities for image ${image}`,
    );
  }

  return fixed;
}

// deno run --allow-run=trivy script.ts
async function runTrivyScan(image: string): Promise<Vulnerability[]> {
  //capture the command's standard output instead of printing it directly to the terminal.
  // when you execute an external process, it inherits the parent's stdout (your terminal).
  // with piped, Deno creates a pipe between the child process and your Deno program.
  const command = new Deno.Command("trivy", {
    args: [
      "image",
      "--format",
      "json",
      "--exit-code",
      "0",
      image,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  console.log(`Running Trivy scan of image ${image}`);

  // without piped Trivy's output goes directly to the terminal.
  // we cannot access it through stdout or stderr.
  const { code, stdout, stderr } = await command.output();

  const output = new TextDecoder().decode(stdout);

  if (code !== 0) {
    throw new Error(`Trivy failed: ${new TextDecoder().decode(stderr)}`);
  }

  const report: TrivyReport = TrivyReportSchema.parse(JSON.parse(output));
  const vulnerabilities: Vulnerability[] = report.Results[0].Vulnerabilities ??
    [];

  console.log(
    `Found ${vulnerabilities.length} vulnerabilities in Trivy scan for image ${image}`,
  );

  return vulnerabilities;
}

async function getLatestBaseImageDigest(): Promise<string> {
  const url = getRegistryUrl();
  const response = await fetch(getRegistryUrl());

  if (!response.ok) {
    throw new Error(`API request to ${url} failed: ${response.status}`);
  }

  const raw = await response.json();
  console.log(`API response: ${raw}`);
  const args = parseArgs(Deno.args);
  const registry = args.registry;

  if (dockerhub(registry)) {
    return getDockerhubImageDigest(raw);
  }

  if (gcr(registry)) {
    return getGcrIoImageDigest(raw);
  }

  throw error(`Unknown registry ${registry}`);
}

function getDockerhubImageDigest(data: unknown): string {
  const images: DockerhubImage[] = DockerhubSchema.parse(data).images;

  for (const image of images) {
    if (image.architecture === "amd64") {
      console.log(
        `Found latest amd64 image on DockerHub. Digest: ${image.digest}`,
      );
      return image.digest;
    }
  }
  throw error(`amd64 image not found on Dockerhub`);
}

function getGcrIoImageDigest(data: unknown): string {
  const images: GcrIoImage[] = GcrIoSchema.parse(data).manifests;

  for (const image of images) {
    if (image.platform.architecture === "amd64") {
      console.log(
        `Found latest amd64 image on gcr.io. Digest: ${image.digest}`,
      );
      return image.digest;
    }
  }
  throw error(`amd64 image not found in gcr.io`);
}

function getRegistryUrl(): string {
  const args = parseArgs(Deno.args);

  //nginxinc/nginx-unprivileged:stable-alpine3.24@shafff
  const imageWithDigest = args.base_image;

  //nginxinc/nginx-unprivileged:stable-alpine3.24
  const base = imageWithDigest.split("@")[0];

  // https://hub.docker.com/v2/namespaces
  // https://gcr.io/v2/distroless
  const registry = args.registry;

  if (dockerhub(registry)) {
    //nginxinc
    const namespace = base.split(":")[0].split("/")[0];
    //ginx-unprivileged
    const repo = base.split(":")[0].split("/")[1];
    //stable-alpine3.24
    const tag = base.split(":")[1];
    const url = `${registry}/${namespace}/repositories/${repo}/tags/${tag}`;

    //https://hub.docker.com/v2/namespaces/nginxinc/repositories/nginx-unprivileged/tags/stable-alpine3.24
    console.log(`Querying docker hub API for latest digest ${url}`);

    return url;
  }

  if (gcr(registry)) {
    //gcr.io/distroless/static-debian12
    const image = base.split("/")[2];
    const url = `${registry}/${image}/manifests/latest`;

    //https://gcr.io/v2/distroless/static-debian12/manifests/latest
    console.log(`Querying gcr.io API for latest digest ${url}`);

    return url;
  }

  throw error(`Unknown Registry ${registry}`);
}

function dockerhub(registry: string): boolean {
  return registry.includes("hub.docker.com");
}

function gcr(registry: string): boolean {
  return registry.includes("gcr.io");
}

async function checkCveInIgnoreList(
  cve: Vulnerability,
): Promise<CveEvalResult> {
  const cveIgnores: CveIgnoreEntry[] = await parseTrivyIgnore(
    "trivyignore.yaml",
  );
  const cveIgnoreEntry: CveIgnoreEntry | null = cveInIgnoreList(
    cve,
    cveIgnores,
  );

  const result: CveEvalResult = {
    cve: cve.VulnerabilityID,
    error: null,
  };

  //CVE exists in the ignore list
  if (cveIgnoreEntry) {
    const expired: boolean = cveIgnoreExpired(cveIgnoreEntry);
    result.error = expired
      ? "CVE needs manual investigation. It is in CVE ignore list, but expired"
      : null;
    return result;
  }

  // CVE not in the ignore list
  result.error = "CVE needs manual investigation. It is not in CVE ignore list";
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

