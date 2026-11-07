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

export const DockerhubImageSchema = z.object({
  architecture: z.string(),
  digest: z.string(),
  last_pushed: z.string()
})

export const DockerhubSchema = z.object({
  images: z.array(DockerhubImageSchema) 
})


export const GcrIoImageSchema = z.object({
  platform: z.object({
    os: z.string(),
    architecture: z.string()
  }),
  digest: z.string(),
  last_pushed: z.string()
})

export const GcrIoSchema = z.object({
  manifests: z.array(GcrIoImageSchema) 
})

export type GcrIoRegistry = z.infer<typeof GcrIoSchema>
export type GcrIoImage = z.infer<typeof GcrIoImageSchema>
export type Dockerhub = z.infer<typeof DockerhubSchema>
export type DockerhubImage = z.infer<typeof DockerhubImageSchema>
export type Vulnerability = z.infer<typeof VulnerabilitySchema>;
export type TrivyResult = z.infer<typeof TrivyResultSchema>;
export type TrivyReport = z.infer<typeof TrivyReportSchema>;
export type CveIgnoreEntry = z.infer<typeof CveIgnoreEntrySchema>;