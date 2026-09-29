import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FEATURE_KEYS, isFeatureKey, type FeatureKey } from '../features.constants.js';

export type FeatureMap = Record<FeatureKey, boolean>;

/**
 * Per-client feature switches. Every known feature defaults to ON; a row only
 * exists once an admin has changed it. This hides features in the portal, it
 * is not a data-access control: the data itself stays behind the usual guards.
 */
@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async getFlags(clientId: string): Promise<FeatureMap> {
    const rows = await this.prisma.clientFeatureFlag.findMany({ where: { clientId, deletedAt: null } });
    const map = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureMap;
    for (const row of rows) {
      if (isFeatureKey(row.featureKey)) map[row.featureKey] = row.enabled;
    }
    return map;
  }

  async setFlag(clientId: string, key: string, enabled: boolean, actorId: string): Promise<FeatureMap> {
    if (!isFeatureKey(key)) throw new BadRequestException(`Unknown feature: ${key}.`);
    const existing = await this.prisma.clientFeatureFlag.findFirst({ where: { clientId, featureKey: key, deletedAt: null } });
    if (existing) {
      await this.prisma.clientFeatureFlag.update({ where: { id: existing.id }, data: { enabled, updatedBy: actorId } });
    } else {
      await this.prisma.clientFeatureFlag.create({ data: { clientId, featureKey: key, enabled, updatedBy: actorId } });
    }
    return this.getFlags(clientId);
  }
}
