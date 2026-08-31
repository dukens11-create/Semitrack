import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "../config/env.js";
import { secureDatabaseConnectionString } from "./databaseConnection.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: secureDatabaseConnectionString(env.databaseUrl),
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
});

pool.on("error", (error) => {
  console.error(`[database] idle PostgreSQL connection failed: ${error.name}`);
});

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
