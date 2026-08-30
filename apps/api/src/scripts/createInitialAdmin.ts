import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../utils/password.js";

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

async function readSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Administrator creation must be run from an interactive terminal");
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Administrator creation canceled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\b" || character === "\u007f") {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          stdout.write("•");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", disabledAt: null } });
  if (activeAdmins > 0) {
    throw new Error("An active administrator already exists. Use Account security in the admin portal instead.");
  }

  const prompts = createInterface({ input: stdin, output: stdout });
  const fullName = await prompts.question("Administrator name: ");
  const email = await prompts.question("Administrator email: ");
  prompts.close();
  const password = await readSecret("Administrator password (12+ characters): ");
  const confirmation = await readSecret("Confirm administrator password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");

  const input = bootstrapSchema.parse({ fullName, email, password });
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new Error("An account with that email already exists");

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: "ADMIN",
        emailVerified: true,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorUserId: admin.id,
        action: "INITIAL_ADMIN_CREATED",
        targetType: "USER",
        targetId: admin.id,
        metadataJson: { bootstrap: true },
      },
    });
  });
  stdout.write("Initial administrator created. Credentials were not printed.\n");
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Administrator creation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
