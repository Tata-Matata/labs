import { parseArgs } from "@std/cli";
import { parseReport } from "./trivy-parse-report.ts";
import {
  type Vulnerability,
} from "./schemas.ts";
import { z } from "zod";

try {
  // JS object!
  const args = parseArgs(Deno.args);
  console.log(`Script args ${JSON.stringify(args, null, 2)}`);

  const vulnerabilities: Vulnerability[] = await parseReport(args.trivyreport);
  if (vulnerabilities.length === 0) {
    console.log("No vulnerabilities found");
    Deno.exit(0);
  }

  console.log(`Trivy found ${vulnerabilities.length}  vulnerabilities`);
  console.log(
    `Searching for these CVEs in Trivy's report: ${args.vulnerabilities}`,
  );
  const searchCves: string[] = String(args.vulnerabilities).split(",");

  vulnerabilities.forEach((cveInReport) => {
    if (searchCves.includes(cveInReport.VulnerabilityID)) {
      console.info(`FOUND CVE ${cveInReport.VulnerabilityID}`);
    } else {
      console.info(
        `CVE ${cveInReport.VulnerabilityID} is not in the searched list`,
      );
    }
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Parsing error:", error.issues);
  }
  console.error(error);
  Deno.exit(1);
}




