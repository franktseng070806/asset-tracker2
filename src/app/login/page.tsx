'use client'

import { useState } from 'react'
import { login, signup } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 攔截表單提交，處理 Loading 狀態與錯誤訊息
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>, action: typeof login) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    
    const formData = new FormData(event.currentTarget)
    const result = await action(formData)
    
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">💰 資產追蹤</CardTitle>
          <CardDescription>掌控您的全幣別資產與投資組合</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">登入</TabsTrigger>
              <TabsTrigger value="signup">註冊</TabsTrigger>
            </TabsList>

            {/* 登入表單 */}
            <TabsContent value="login">
              <form onSubmit={(e) => handleSubmit(e, login)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input id="login-email" name="email" type="email" required placeholder="your@email.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">密碼</Label>
                  <Input id="login-password" name="password" type="password" required />
                </div>
                {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? '登入中...' : '登入'}
                </Button>
              </form>
            </TabsContent>

            {/* 註冊表單 */}
            <TabsContent value="signup">
              <form onSubmit={(e) => handleSubmit(e, signup)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" name="email" type="email" required placeholder="your@email.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">密碼 (至少 6 碼)</Label>
                  <Input id="signup-password" name="password" type="password" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">確認密碼</Label>
                  <Input id="confirm-password" name="confirmPassword" type="password" required />
                </div>
                {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? '處理中...' : '註冊'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}