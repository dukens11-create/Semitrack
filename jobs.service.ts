import { prisma } from "../../lib/prisma.js";

export async function createReminderNotifications() {
  const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const expiring = await prisma.complianceItem.findMany({
    where: { expiresAt: { lte: cutoff } },
    take: 100,
  });

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "FLEET_ADMIN"] } },
    take: 20,
  });

  for (const item of expiring) {
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title: `Compliance item expiring: ${item.title}`,
          body: `${item.type} expires on ${item.expiresAt.toISOString()}`,
        },
      });
    }
  }

  return {
    remindersCreatedForItems: expiring.length,
    adminRecipients: admins.length,
  };
}
