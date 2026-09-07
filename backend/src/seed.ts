import { PrismaClient, StaffRole } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // 1. Create or find the ShriMelan branch
  const branch = await prisma.branch.upsert({
    where: {
      id: "shrimelan-main-branch",
    },
    update: {},
    create: {
      id: "shrimelan-main-branch",
      name: "ShriMelan — BHEL, Bhopal",
      address: "BHEL, Bhopal, Madhya Pradesh",
      phone: "9999999999",
      whatsapp: "9999999999",
      email: "admin@shrimelan.com",
      openTime: "11:00",
      closeTime: "23:00",
    },
  });

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("SEED_ADMIN_EMAIL and a 12+ character SEED_ADMIN_PASSWORD are required");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // 5. Create or update staff account
  const staff = await prisma.staff.upsert({
    where: {
      email,
    },
    update: {
      passwordHash,
      name: "ShriMelan Admin",
      role: StaffRole.ADMIN,
      branchId: branch.id,
      active: true,
    },
    create: {
      name: "ShriMelan Admin",
      email,
      passwordHash,
      role: StaffRole.ADMIN,
      branchId: branch.id,
      active: true,
    },
  });

  console.log("Admin seed completed:", {
    email: staff.email,
    role: staff.role,
    branch: branch.name,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });