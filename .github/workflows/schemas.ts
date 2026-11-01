import { z } from "zod";

export const VulnerabilitySchema = z.object({
  VulnerabilityID: z.string(),
  PkgName: z.string(),
  InstalledVersion: z.string(),
  FixedVersion: z.string(),
  Severity: z.string(),
});


export const CveIgnoreEntrySchema = z.object({
  id: z.string(),
  expired_at: z.string(),
  statement: z.string(),
});


export const TrivyResultSchema = z.object({
  Target: z.string(),
  Vulnerabilities: z.array(VulnerabilitySchema).nullable(),
});

export const TrivyReportSchema = z.object({
    Results: z.array(TrivyResultSchema)
})


export type Vulnerability = z.infer<typeof VulnerabilitySchema>;
export type TrivyResult = z.infer<typeof TrivyResultSchema>;
export type TrivyReport = z.infer<typeof TrivyReportSchema>;
export type CveIgnoreEntry = z.infer<typeof CveIgnoreEntrySchema>;