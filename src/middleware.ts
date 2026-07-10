// src/middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // 每次請求都經過我們的 Session 刷新與路由保護邏輯
  return await updateSession(request)
}

export const config = {
  // 決定哪些路徑要經過守門員 (排除靜態檔案與圖片，節省伺服器效能)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}