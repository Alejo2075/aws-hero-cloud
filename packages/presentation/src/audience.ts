/**
 * How much explanation a reader needs. Levels are views over the same data: they change wording
 * and depth, never facts, costs, or destructive changes.
 */
export const audienceLevels = ['simple', 'guided', 'expert'] as const;
export type AudienceLevel = (typeof audienceLevels)[number];

export const defaultAudienceLevel: AudienceLevel = 'simple';
