import { PrismaClient } from "@prisma/client";
import data from "./menu-seed-data.json";

const prisma = new PrismaClient();

type SourceMenuItem = {
  Item_ID: string;
  Item_Name: string;
  Category: string;
  Cost_to_Make: number;
  Price: number;
  Stock_Qty: number;
  Image_URL: string;
  Description: string;
  Rating: number;
};

const menu = (data as { menu: SourceMenuItem[] }).menu;

function categoryId(name: string): string {
  return `imported-category-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function imageUrl(value: string): string {
  // The ZIP's local image paths are copied to frontend/public/menu-images.
  return value.startsWith("menu-images/") ? `/${value}` : value;
}

async function main() {
  const branch = await prisma.branch.findUnique({ where: { id: "shrimelan-main-branch" } });
  if (!branch) {
    throw new Error("Main ShriMelan branch not found. Run npm run seed before importing the menu.");
  }

  const categoryIds = new Map<string, string>();
  for (const [index, name] of [...new Set(menu.map((item) => item.Category))].entries()) {
    const id = categoryId(name);
    await prisma.menuCategory.upsert({
      where: { id },
      update: { name, branchId: branch.id, sortOrder: index + 1 },
      create: { id, name, branchId: branch.id, sortOrder: index + 1 },
    });
    categoryIds.set(name, id);
  }

  for (const item of menu) {
    await prisma.menuItem.upsert({
      where: { itemCode: item.Item_ID },
      update: {
        categoryId: categoryIds.get(item.Category)!,
        name: item.Item_Name,
        description: item.Description,
        price: item.Price,
        costToMake: item.Cost_to_Make,
        stockQty: item.Stock_Qty,
        rating: item.Rating,
        imageUrl: imageUrl(item.Image_URL),
        isVeg: true,
        isAvailable: item.Stock_Qty > 0,
      },
      create: {
        itemCode: item.Item_ID,
        categoryId: categoryIds.get(item.Category)!,
        name: item.Item_Name,
        description: item.Description,
        price: item.Price,
        costToMake: item.Cost_to_Make,
        stockQty: item.Stock_Qty,
        rating: item.Rating,
        imageUrl: imageUrl(item.Image_URL),
        isVeg: true,
        isAvailable: item.Stock_Qty > 0,
      },
    });
  }

  console.log(`Imported ${menu.length} menu items across ${categoryIds.size} categories.`);
}

main()
  .catch((error) => {
    console.error("Menu import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
