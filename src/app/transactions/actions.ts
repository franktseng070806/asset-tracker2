// src/app/transactions/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

/**
 * 🛡️ 核心資安防護：驗證該帳戶是否真的屬於目前登入的使用者
 */
async function verifyAccountOwnership(accountId: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error('Unauthorized: 尚未登入')
  }

  // 透過關聯查詢，確認該交割帳戶所屬的銀行，是否綁定在目前使用者的 ID 下
  const account = await prisma.cashAccount.findUnique({
    where: { id: accountId },
    include: { bank: true }
  })

  if (!account || account.bank.userId !== user.id) {
    throw new Error('Forbidden: 您無權操作此帳戶')
  }

  return true
}

// ==========================================
// 處理現金入金與出金
// ==========================================
export async function createCashTx(formData: FormData) {
  const accountId = Number(formData.get('accountId'))
  
  // 執行安全鎖
  await verifyAccountOwnership(accountId)

  const type = formData.get('type') as string
  const amount = Number(formData.get('amount'))
  const date = new Date(formData.get('date') as string)
  const note = formData.get('note') as string

  if (!accountId || !amount) return

  await prisma.cashTransaction.create({
    data: { accountId, type, amount, date, note }
  })

  revalidatePath('/transactions')
  revalidatePath('/') 
}

// ==========================================
// 處理股票買賣 (支援跨幣別交割)
// ==========================================
export async function createStockTx(formData: FormData) {
  const accountId = Number(formData.get('accountId'))
  
  // 執行安全鎖
  await verifyAccountOwnership(accountId)

  const action = formData.get('action') as string
  const ticker = (formData.get('ticker') as string).toUpperCase()
  const assetCurrency = (formData.get('assetCurrency') as string).toUpperCase()
  const price = Number(formData.get('price'))
  const shares = Number(formData.get('shares'))
  
  const settlementFxRate = Number(formData.get('settlementFxRate')) || 1.0
  const fee = Number(formData.get('fee')) || 0
  const date = new Date(formData.get('date') as string)

  if (!accountId || !ticker || !price || !shares) return

  await prisma.stockTransaction.create({
    data: {
      accountId, date, action, ticker, assetCurrency,
      price, shares, settlementFxRate, fee, tradeType: 'CASH'
    }
  })

  revalidatePath('/transactions')
  revalidatePath('/') 
}