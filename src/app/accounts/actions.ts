'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// 新增銀行 (例如：國泰世華、玉山銀行)
export async function createBank(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const name = formData.get('name') as string
  if (!name) return

  await prisma.bank.create({
    data: { userId: user.id, name }
  })
  
  revalidatePath('/accounts') // 重新整理頁面資料
}

// 新增交割帳戶 (例如：台幣帳戶、美金帳戶)
export async function createAccount(formData: FormData) {
  const bankId = Number(formData.get('bankId'))
  const currency = formData.get('currency') as string

  if (!bankId || !currency) return

  await prisma.cashAccount.create({
    data: { bankId, currency }
  })
  
  revalidatePath('/accounts')
}