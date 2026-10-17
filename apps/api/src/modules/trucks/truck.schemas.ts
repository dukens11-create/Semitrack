import { z } from "zod";
const truckFields = {
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  tractorType: z.string().max(80).nullable().optional(),
  trailerType: z.string().max(80).nullable().optional(),
  trailerCount: z.number().int().min(0).max(4).default(1),
  unitNumber: z.string().max(40).nullable().optional(),
  trailerNumber: z.string().max(40).nullable().optional(),
  heightFt: z.number().min(4).max(20),
  currentWeightLbs: z.number().int().min(1_000).max(300_000).nullable().optional(),
  weightLbs: z.number().int().min(1_000).max(300_000),
  weightPerAxleLbs: z.number().int().min(500).max(100_000).nullable().optional(),
  widthFt: z.number().min(4).max(20),
  lengthFt: z.number().min(8).max(150),
  hazmatEnabled: z.boolean().default(false),
  hazardousGoods: z.array(z.enum(["explosive","gas","flammable","combustible","organic","poison","radioactive","corrosive","poisonousInhalation","harmfulToWater","other"])).default([]),
  axleCount: z.number().int().min(2).max(20),
  avoidTolls: z.boolean().default(false),
  avoidFerries: z.boolean().default(false),
  avoidHighways: z.boolean().default(false),
  avoidResidential: z.boolean().default(true),
  avoidDirtRoads: z.boolean().default(true),
};
const truckBaseSchema = z.object(truckFields);
const validateTruck = (value: z.infer<typeof truckBaseSchema>, ctx: z.RefinementCtx) => {
  if (value.currentWeightLbs && value.currentWeightLbs > value.weightLbs) {
    ctx.addIssue({ code: "custom", path: ["currentWeightLbs"], message: "Current weight cannot exceed gross weight" });
  }
  if (value.hazmatEnabled !== (value.hazardousGoods.length > 0)) {
    ctx.addIssue({ code: "custom", path: ["hazardousGoods"], message: "Select at least one hazardous-goods class" });
  }
};
export const truckSchema = truckBaseSchema.superRefine(validateTruck);
export const truckUpdateSchema = truckBaseSchema.partial();

export const routingTruckSchema = truckBaseSchema.omit({ name: true, isDefault: true, tractorType: true, unitNumber: true, trailerNumber: true }).extend({ trailerCount: truckFields.trailerCount.removeDefault(), hazmatEnabled: truckFields.hazmatEnabled.removeDefault(), hazardousGoods: truckFields.hazardousGoods.removeDefault(), avoidTolls: truckFields.avoidTolls.removeDefault(), avoidFerries: truckFields.avoidFerries.removeDefault(), avoidHighways: truckFields.avoidHighways.removeDefault(), avoidResidential: truckFields.avoidResidential.removeDefault(), avoidDirtRoads: truckFields.avoidDirtRoads.removeDefault() }).superRefine((value, ctx) => validateTruck({ ...value, name: "Route validation" }, ctx));
