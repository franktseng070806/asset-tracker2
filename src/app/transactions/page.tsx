// src/app/transactions/page.tsx
import Navbar from '@/components/Navbar'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { createCashTx, createStockTx } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 撈取使用者的交割帳戶選單，並組合上銀行名稱
  const banks = await prisma.bank.findMany({
    where: { userId: user?.id },
    include: { accounts: true }
  })
  const allAccounts = banks.flatMap(b => b.accounts.map(a => ({ ...a, bankName: b.name })))

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-slate-900">交易紀錄</h1>
          <p className="text-slate-500 mt-2">記錄您的現金流水與股票買賣。</p>
        </header>

        <Tabs defaultValue="cash" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="cash">現金出入金</TabsTrigger>
            <TabsTrigger value="stock">股票買賣</TabsTrigger>
          </TabsList>

          {/* 💵 現金表單 */}
          <TabsContent value="cash">
            <Card className="shadow-sm border-t-4 border-t-emerald-500">
              <CardHeader><CardTitle>新增現金流水</CardTitle></CardHeader>
              <CardContent>
                <form action={createCashTx} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>選擇交割帳戶</Label>
                      <select name="accountId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">請選擇...</option>
                        {allAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>{acc.bankName} - {acc.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>交易類型</Label>
                      <select name="type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="DEPOSIT">入金 (Deposit)</option>
                        <option value="WITHDRAWAL">出金 (Withdrawal)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>金額</Label>
                      <Input name="amount" type="number" step="0.01" required placeholder="例如: 10000" />
                    </div>
                    <div className="space-y-2">
                      <Label>日期</Label>
                      <Input name="date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>備註 (選填)</Label>
                      <Input name="note" placeholder="例如: 薪水入帳" />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">送出紀錄</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 📈 股票表單 */}
          <TabsContent value="stock">
            <Card className="shadow-sm border-t-4 border-t-indigo-500">
              <CardHeader><CardTitle>新增股票交易</CardTitle></CardHeader>
              <CardContent>
                <form action={createStockTx} className="space-y-6">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>扣款 / 入帳交割帳戶</Label>
                      <select name="accountId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="">請選擇...</option>
                        {allAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>{acc.bankName} - {acc.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>買 / 賣</Label>
                      <select name="action" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                        <option value="BUY">買入 (Buy)</option>
                        <option value="SELL">賣出 (Sell)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>日期</Label>
                      <Input name="date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div className="space-y-2">
                      <Label>股票代號 (如 TSLA, 2330.TW)</Label>
                      <Input name="ticker" required className="uppercase" placeholder="TSLA" />
                    </div>
                    <div className="space-y-2">
                      <Label>標的計價幣別 (如 USD, TWD)</Label>
                      <Input name="assetCurrency" required className="uppercase" placeholder="USD" />
                    </div>
                    <div className="space-y-2">
                      <Label>成交單價 (原生幣別)</Label>
                      <Input name="price" type="number" step="0.000001" required placeholder="300.5" />
                    </div>
                    <div className="space-y-2">
                      <Label>總股數</Label>
                      <Input name="shares" type="number" step="0.000001" required placeholder="10" />
                    </div>
                    <div className="space-y-2">
                      <Label>交割匯率 (若為同幣別交割請維持 1)</Label>
                      <Input name="settlementFxRate" type="number" step="0.000001" defaultValue="1" required />
                    </div>
                    <div className="space-y-2">
                      <Label>手續費 (以交割帳戶幣別計價)</Label>
                      <Input name="fee" type="number" step="0.01" defaultValue="0" required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">送出交易</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}