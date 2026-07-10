import Navbar from '@/components/Navbar'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { generateDailySnapshots } from '@/lib/financial/netWorth'
import { calculateAccountHoldings } from '@/lib/financial/stocks'
import { calculateAccountBalance } from '@/lib/financial/cash'
import { calculateMarginStatus } from '@/lib/financial/margin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AssetChart from '@/components/AssetChart'

async function getFx(from: string, to: string) {
  if (from === to) return 1
  const fx = await prisma.exchangeRate.findUnique({
    where: { fromCurrency_toCurrency: { fromCurrency: from, toCurrency: to } }
  })
  return fx ? Number(fx.rate) : 1
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser) {
    dbUser = await prisma.user.create({ data: { id: user.id, email: user.email!, baseCurrency: 'TWD' } })
  }

  const totalNetWorth = await generateDailySnapshots(user.id)

  const banks = await prisma.bank.findMany({
    where: { userId: user.id },
    include: { accounts: true }
  })

  const holdingsList = []
  const marginLoansList = []
  const chartData: { name: string, value: number }[] = []
  let totalInvestedBase = 0
  let totalUnrealizedBase = 0

  for (const bank of banks) {
    for (const acc of bank.accounts) {
      
      // 1. 現金聚合
      const cash = await calculateAccountBalance(acc.id)
      if (cash > 0) {
        const cashFx = await getFx(acc.currency, dbUser.baseCurrency)
        chartData.push({ name: `現金 (${acc.currency})`, value: cash * cashFx })
      }

      // 2. 持股明細與行情聚合
      const holdings = await calculateAccountHoldings(acc.id)
      for (const h of holdings) {
        const quote = await prisma.marketQuote.findUnique({ where: { ticker: h.ticker } })
        const currentPrice = quote ? Number(quote.currentPrice) : h.avgCost
        const fx = await getFx(h.assetCurrency, dbUser.baseCurrency)

        const totalCostBase = (h.avgCost * h.shares) * fx
        const marketValueBase = (currentPrice * h.shares) * fx
        const unrealizedBase = marketValueBase - totalCostBase

        totalInvestedBase += totalCostBase
        totalUnrealizedBase += unrealizedBase

        holdingsList.push({
          ticker: h.ticker,
          currency: h.assetCurrency,
          shares: h.shares,
          avgCost: h.avgCost,
          currentPrice,
          unrealized: (currentPrice - h.avgCost) * h.shares,
          returnRate: ((currentPrice - h.avgCost) / h.avgCost) * 100
        })

        chartData.push({ name: h.ticker, value: marketValueBase })
      }

      // 3. 融資借款狀態與維持率追蹤 (Phase 2.3 核心解鎖)
      const marginStatuses = await calculateMarginStatus(acc.id)
      for (const m of marginStatuses) {
        marginLoansList.push({
          ...m,
          bankName: bank.name
        })
      }
    }
  }

  // 檢查是否有任何一筆融資低於 140% 安全線
  const hasMarginAlert = marginLoansList.some(m => m.maintenanceRatio > 0 && m.maintenanceRatio < 140)

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <Navbar />
      
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {/* 風控警示橫幅：當維持率告急時自動觸發 */}
        {hasMarginAlert && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md shadow-sm animate-pulse">
            <div className="flex">
              <div className="flex-shrink-0">⚠️</div>
              <div className="ml-3">
                <h3 className="text-sm font-bold text-red-800">高風險資產警告：融資維持率過低！</h3>
                <p className="text-xs text-red-700 mt-1">您有融資合約之維持率已逼近 130% 斷頭線，請密切注意市場波動或適時補繳保證金。</p>
              </div>
            </div>
          </div>
        )}

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">早安！您的資產總覽</h1>
        </header>
        
        {/* 指標卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-t-4 border-t-emerald-500 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">總資產淨值 ({dbUser.baseCurrency})</CardTitle></CardHeader>
            <CardContent>
              <p className="text-4xl font-bold text-slate-900">
                ${totalNetWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">總投入成本 ({dbUser.baseCurrency})</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-700">
                ${totalInvestedBase.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">未實現損益 ({dbUser.baseCurrency})</CardTitle></CardHeader>
            <CardContent>
              <p className={`text-2xl font-semibold ${totalUnrealizedBase >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                {totalUnrealizedBase > 0 ? '+' : ''}${totalUnrealizedBase.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 核心數據區塊 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader><CardTitle className="text-lg">資產分佈</CardTitle></CardHeader>
            <CardContent><AssetChart data={chartData} /></CardContent>
          </Card>

          <Card className="lg:col-span-2 shadow-sm overflow-hidden">
            <CardHeader><CardTitle className="text-lg">持股明細 (依標的原生幣別)</CardTitle></CardHeader>
            <CardContent className="p-0">
              {holdingsList.length === 0 ? (
                <div className="p-6 text-center text-slate-400">尚無持股紀錄</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>標的</TableHead>
                      <TableHead className="text-right">股數</TableHead>
                      <TableHead className="text-right">均價 / 現價</TableHead>
                      <TableHead className="text-right">未實現損益</TableHead>
                      <TableHead className="text-right">報酬率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holdingsList.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-bold">{h.ticker} <span className="text-xs text-slate-400 font-normal ml-1">{h.currency}</span></TableCell>
                        <TableCell className="text-right">{h.shares.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <div className="text-xs text-slate-400">均 {h.avgCost.toFixed(2)}</div>
                          <div className="font-medium">現 {h.currentPrice.toFixed(2)}</div>
                        </TableCell>
                        <TableCell className={`text-right font-medium ${h.unrealized >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {h.unrealized > 0 ? '+' : ''}{h.unrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${h.returnRate >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {h.returnRate > 0 ? '+' : ''}{h.returnRate.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 🔍 融資風控即時監控面板 (當有開槓桿時才會動態顯示) */}
        {marginLoansList.length > 0 && (
          <Card className="shadow-sm mt-6 border-t-4 border-t-amber-500">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">🛡️ 融資槓桿監控面板</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>機構 / 標的</TableHead>
                    <TableHead className="text-right">融資股數</TableHead>
                    <TableHead className="text-right">借款本金</TableHead>
                    <TableHead className="text-right">擔保品市值</TableHead>
                    <TableHead className="text-right">即時維持率</TableHead>
                    <TableHead className="text-center">風險狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marginLoansList.map((m, i) => {
                    // 定義維持率的顏色級別
                    let ratioColor = 'text-green-600 font-bold'
                    let statusBadge = 'bg-green-100 text-green-800'
                    let statusText = '安全'

                    if (m.maintenanceRatio < 130) {
                      ratioColor = 'text-red-600 font-black animate-bounce'
                      statusBadge = 'bg-red-600 text-white font-bold'
                      statusText = '處分斷頭'
                    } else if (m.maintenanceRatio < 140) {
                      ratioColor = 'text-red-500 font-bold'
                      statusBadge = 'bg-red-100 text-red-800'
                      statusText = '追繳警告'
                    } else if (m.maintenanceRatio < 160) {
                      ratioColor = 'text-amber-500 font-semibold'
                      statusBadge = 'bg-amber-100 text-amber-800'
                      statusText = '注意觀察'
                    }

                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="font-semibold">{m.ticker}</div>
                          <div className="text-xs text-slate-400">{m.bankName}</div>
                        </TableCell>
                        <TableCell className="text-right">{m.loanShares.toLocaleString()} 股</TableCell>
                        <TableCell className="text-right">{m.loanAmount.toLocaleString()} {m.loanCurrency}</TableCell>
                        <TableCell className="text-right">{m.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} {m.loanCurrency}</TableCell>
                        <TableCell className={`text-right ${ratioColor}`}>
                          {m.maintenanceRatio > 0 ? `${m.maintenanceRatio.toFixed(1)}%` : '計算中'}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadge}`}>
                            {statusText}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}