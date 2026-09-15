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
        ...(snapshot.complete === true ? (provider.config.dataType === "ROAD_EVENTS" ? [prisma.dotRoadEvent.updateMany({
          where: {provider: provider.id, providerEventId: {notIn: snapshot.events.map(event => event.providerEventId)}}, data: {active: false},
        })] : [prisma.trafficCamera.updateMany({
          where: {provider: provider.id, providerCameraId: {notIn: snapshot.cameras.map(camera => camera.providerCameraId)}}, data: {active: false},
        })]) : []),
        ...snapshot.events.map(({geometry, ...event}) => prisma.dotRoadEvent.upsert({
          where: { provider_providerEventId: { provider: provider.id, providerEventId: event.providerEventId } },
          create: { provider: provider.id, ...event, geometryJson: geometry as object | undefined },
          update: { ...event, geometryJson: geometry as object | undefined },
        })),
        ...snapshot.cameras.map((camera) => prisma.trafficCamera.upsert({
          where: { provider_providerCameraId: { provider: provider.id, providerCameraId: camera.providerCameraId } },
          create: { provider: provider.id, ...camera },
          update: camera,
        })),
        prisma.providerSyncState.update({
          where: { id: state.id },
          data: {
            status: snapshot.complete ? "HEALTHY" : "DEGRADED",
            lastSuccessAt: snapshot.complete ? snapshot.fetchedAt : state.lastSuccessAt,
            lastErrorCode: snapshot.complete ? null : "SNAPSHOT_COMPLETENESS_UNVERIFIED",
            lastErrorMessage: snapshot.complete ? null : "Feed completeness is unverified; existing records were not retired.",
            itemCount: snapshot.events.length + snapshot.cameras.length,
          },
        }),
      ]);
      return { provider: provider.id, skipped: false, itemCount: snapshot.events.length + snapshot.cameras.length };
    } catch (error) {
      const message = "Provider sync failed; previous data is not current.";
      await prisma.providerSyncState.update({
        where: { id: state.id },
        data: { status: state.lastSuccessAt ? "DEGRADED" : "ERROR", lastErrorCode: "FETCH_FAILED", lastErrorMessage: message },
      });
      throw error;
    }
  }));
}
