import "dotenv/config";
import argon2 from "argon2";
import { PrismaClient, UserRole } from "@prisma/client";

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (const arg of args) {
    const [key, value] = arg.split("=");
    if (key && value) {
      result[key.replace(/^--/, "")] = value;
    }
  }
  return result;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const args = parseArgs();
    const email = args.email;
    const password = args.password;
    const displayName = args.name || args.displayName;
    const roleInput = args.role?.toUpperCase() || "USER";

    if (!email || !password || !displayName) {
      console.error(
        "Usage: ts-node --transpile-only scripts/create-user.ts --email=user@example.com --password=TempPass123 --name=\"Display Name\" [--role=ADMIN|USER]"
      );
      process.exit(1);
    }

    if (!["ADMIN", "USER"].includes(roleInput)) {
      console.error("Role must be ADMIN or USER");
      process.exit(1);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.error("A user with that email already exists.");
      process.exit(1);
    }

    const passwordHash = await argon2.hash(password);
    await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        role: roleInput as UserRole,
      },
    });

    console.log(`User ${email} created with role ${roleInput}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
