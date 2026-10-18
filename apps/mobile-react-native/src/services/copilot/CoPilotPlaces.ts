import { z } from 'zod';
import { coPilotHost } from './CoPilotHost';
export const coPilotPoiCatalogSchema = z.array(
  z.object({
    id: z.number().int().nonnegative(),
    name: z.string().trim().min(1),
    visible: z.boolean(),
  }),
);
export type CoPilotPoiCategory = z.infer<
  typeof coPilotPoiCatalogSchema
>[number];
export async function readCoPilotPlaces() {
  const host = coPilotHost();
  if (!host.poiCatalog)
    throw new Error('Update the app to connect SemiTraX places');
  return coPilotPoiCatalogSchema.parse(await host.poiCatalog());
}
export async function setCoPilotPlaceVisible(id: number, visible: boolean) {
  const host = coPilotHost();
  if (!host.setPoiCategoryVisible)
    throw new Error('Update the app to connect SemiTraX places');
  const catalog = coPilotPoiCatalogSchema.parse(
    await host.setPoiCategoryVisible(id, visible),
  );
  if (!catalog.some(item => item.id === id && item.visible === visible))
    throw new Error('Visibility not confirmed');
  return catalog;
}
