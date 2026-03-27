import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "change_me",
  routeProvider: process.env.ROUTE_PROVIDER ?? "here",
  hereApiKey: process.env.HERE_API_KEY ?? "",
  mapboxToken: process.env.MAPBOX_TOKEN ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  awsRegion: process.env.AWS_REGION ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
};
