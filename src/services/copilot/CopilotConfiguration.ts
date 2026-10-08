import { z } from 'zod';

export const copilotConfigurationSchema = z
  .object({
    sdkVersion: z.literal('10.28.2.497'),
    platform: z.enum(['android', 'ios']),
    environment: z.enum(['development', 'production']),
    licensingMode: z.enum([
      'ams-company',
      'ams-external-account',
      'product-key',
    ]),
    // Opaque native secure-store reference. Credential values must not be put here.
    credentialRef: z.string().trim().min(1),
    mapRegionConstant: z.string().regex(/^[A-Z][A-Za-z0-9_]+$/),
    mapVersion: z
      .object({
        year: z.number().int().min(2000),
        quarter: z.number().int().min(1).max(4),
        version: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();
export type CopilotConfiguration = z.infer<typeof copilotConfigurationSchema>;

/** Implemented by a future native provisioning boundary; no secret read here. */
export interface CopilotProvisioning {
  readConfiguration(): Promise<unknown>;
  hasNativeCredential(reference: string): Promise<boolean>;
}

export class CopilotP0Error extends Error {
  readonly cause!: unknown;
  constructor(
    readonly code: string,
    readonly fields: readonly string[] = [],
    cause?: unknown,
  ) {
    // Never interpolate supplied configuration or native credential payloads.
    super(
      code === 'TRUCK_RESTRICTIONS_UNREPRESENTABLE'
        ? 'Truck guidance is unavailable because required truck restrictions are unsupported.'
        : 'CoPilot setup or navigation prerequisites could not be verified.',
    );
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
    this.name = 'CopilotP0Error';
  }
}

export function parseCopilotConfiguration(
  value: unknown,
): CopilotConfiguration {
  const result = copilotConfigurationSchema.safeParse(value);
  if (!result.success) {
    throw new CopilotP0Error(
      'CONFIGURATION_INVALID',
      result.error.issues.map(issue => issue.path.join('.')),
    );
  }
  return result.data;
}
