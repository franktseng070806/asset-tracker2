// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

// 宣告一個全域變數來暫存 Prisma 實例，避免在開發環境重複連線
const globalForPrisma = global as unknown as { prisma: PrismaClient }

// 🛡️ 核心關鍵：裡面「完全不傳」任何參數！
// Prisma 會在系統正式運行、第一次發送 Query 時，才自動去深層讀取 DATABASE_URL
export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma