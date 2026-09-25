/**
 * Seeds the permission catalog and the starter role -> permission grants
 * described in docs/analysis/auth.md. Safe to re-run (upserts).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role } from '../src/generated/prisma/enums.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PERMISSIONS = [
  { key: 'manage_team', description: "Invite, resend, and disable/enable a client's team members." },
  { key: 'manage_client_settings', description: "Manage the client's own account settings." },
] as const;

const ROLE_GRANTS: Record<string, string[]> = {
  [Role.CLIENT_POC]: ['manage_team', 'manage_client_settings'],
  [Role.CLIENT_MEMBER]: [],
};

async function main() {
  const permissionsByKey = new Map<string, string>();

  for (const permission of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
    permissionsByKey.set(row.key, row.id);
  }

  for (const [role, keys] of Object.entries(ROLE_GRANTS)) {
    for (const key of keys) {
      const permissionId = permissionsByKey.get(key);
      if (!permissionId) continue;

      const existing = await prisma.rolePermission.findFirst({
        where: { role: role as Role, permissionId, deletedAt: null },
      });

      if (!existing) {
        await prisma.rolePermission.create({
          data: { role: role as Role, permissionId },
        });
      }
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
