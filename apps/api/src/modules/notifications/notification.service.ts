import { prisma } from "../../lib/prisma.js";

export async function createNotification(input: {
  userId: string;
  type: "DISPATCH" | "WEATHER" | "PARKING" | "ROUTE" | "BILLING" | "SYSTEM";
  title: string;
  body: string;
}) {
  return prisma.notification.create({
    data: input,
  });
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function markNotificationRead(notificationId: string) {
  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}
