import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ConfiguredDot511Provider, parseDotProviderConfigs } from "./providers/dot511Provider.js";

export function configuredDotProviders() {
  return parseDotProviderConfigs(env.dotProviderConfigJson).map((config) => new ConfiguredDot511Provider(config));
}

export async function refreshDotProviders(force = false) {
  const providers = configuredDotProviders();
  return Promise.allSettled(providers.map(async (provider) => {
    const state = await prisma.providerSyncState.upsert({
      where: { provider_jurisdiction_dataType: { provider: provider.id, jurisdiction: provider.jurisdiction, dataType: provider.config.dataType } },
      create: {
        provider: provider.id, jurisdiction: provider.jurisdiction, dataType: provider.config.dataType,
        endpointUrl: provider.endpointUrl, refreshIntervalSec: provider.refreshIntervalSec,
      },
      update: { endpointUrl: provider.endpointUrl, refreshIntervalSec: provider.refreshIntervalSec },
    });
    if (!force && state.lastSuccessAt && Date.now() - state.lastSuccessAt.getTime() < state.refreshIntervalSec * 1000) {
      return { provider: provider.id, skipped: true, itemCount: state.itemCount };
    }
    await prisma.providerSyncState.update({ where: { id: state.id }, data: { lastAttemptAt: new Date() } });
    try {
      const snapshot = await provider.fetchSnapshot();
      await prisma.$transaction([
        ...snapshot.events.map((event) => prisma.dotRoadEvent.upsert({
          where: { provider_providerEventId: { provider: provider.id, providerEventId: event.providerEventId } },
          create: { provider: provider.id, ...event, geometryJson: event.geometry as object | undefined },
          update: { ...event, geometryJson: event.geometry as object | undefined },
        })),
        ...snapshot.cameras.map((camera) => prisma.trafficCamera.upsert({
          where: { provider_providerCameraId: { provider: provider.id, providerCameraId: camera.providerCameraId } },
          create: { provider: provider.id, ...camera },
          update: camera,
        })),
        prisma.providerSyncState.update({
          where: { id: state.id },
          data: {
            status: "HEALTHY", lastSuccessAt: snapshot.fetchedAt,
            lastErrorCode: null, lastErrorMessage: null,
            itemCount: snapshot.events.length + snapshot.cameras.length,
          },
        }),
      ]);
      return { provider: provider.id, skipped: false, itemCount: snapshot.events.length + snapshot.cameras.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider sync failed";
      await prisma.providerSyncState.update({
        where: { id: state.id },
        data: { status: state.lastSuccessAt ? "DEGRADED" : "ERROR", lastErrorCode: "FETCH_FAILED", lastErrorMessage: message },
      });
      throw error;
    }
  }));
}
