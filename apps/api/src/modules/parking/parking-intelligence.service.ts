import { prisma } from "../../lib/prisma.js";

export async function getParkingLotIntelligence(lotName: string) {
  const reports = await prisma.parkingReport.findMany({
    where: { lotName },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (!reports.length) {
    return {
      lotName,
      confidence: 0,
      predictedStatus: "UNKNOWN",
      freshnessMinutes: null,
      totalReports: 0,
    };
  }

  const latest = reports[0];
  const freshnessMinutes = Math.round((Date.now() - new Date(latest.createdAt).getTime()) / 60000);

  const scoreMap: Record<string, number> = {
    AVAILABLE: 2,
    LIMITED: 1,
    FULL: 0,
  };

  const avg =
    reports.reduce((sum, r) => sum + (scoreMap[r.status] ?? 1), 0) / reports.length;

  let predictedStatus = "LIMITED";
  if (avg >= 1.5) predictedStatus = "AVAILABLE";
  else if (avg < 0.75) predictedStatus = "FULL";

  const confidence = Math.max(10, Math.min(100, reports.length * 5 - freshnessMinutes));

  return {
    lotName,
    confidence,
    predictedStatus,
    freshnessMinutes,
    totalReports: reports.length,
    latestStatus: latest.status,
  };
}
