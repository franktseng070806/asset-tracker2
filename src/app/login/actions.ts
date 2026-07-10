'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// 登入邏輯
export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Email 或密碼錯誤' }
  }

  // 登入成功，重新驗證首頁狀態並跳轉
  revalidatePath('/')
  redirect('/')
}

// 註冊邏輯
export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (password !== confirmPassword) {
    return { error: '兩次密碼不一致' }
  }

  if (password.length < 6) {
    return { error: '密碼至少需要 6 個字元' }
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  // Supabase 預設註冊成功會自動登入，直接導向首頁
  revalidatePath('/')
  redirect('/')
}