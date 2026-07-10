import { config } from "dotenv";
import { defineConfig, env } from "@prisma/config";

// 讓 Prisma 知道要去讀取你的 .env.local 檔案
config({ path: ".env.local" });

// 偵測目前終端機執行的指令
const command = process.argv.join(" ");
const isMigration = command.includes("push") || command.includes("migrate");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // 🔥 神奇的動態切換：如果要推播結構就用 DIRECT_URL，否則用 DATABASE_URL
    url: isMigration ? env("DIRECT_URL") : env("DATABASE_URL"),
  },
});