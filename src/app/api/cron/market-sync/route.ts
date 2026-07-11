// src/app/api/cron/market-sync/route.ts
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import yahooFinance from 'yahoo-finance2'
import { generateDailySnapshotsForAllUsers } from '@/lib/financial/netWorth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // 1. 安全防護：確認呼叫者帶有正確的密鑰
  const authHeader = request.headers.get('authorization')
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 從資料庫撈出所有「有交易紀錄」的股票代號
    const txTickers = await prisma.stockTransaction.findMany({
      select: { ticker: true, assetCurrency: true },
      distinct: ['ticker']
    })

    const stockMap = new Map<string, string>()
    txTickers.forEach(t => stockMap.set(t.ticker, t.assetCurrency))

    for (const [ticker, currency] of stockMap.entries()) {
      try {
        const quote = await yahooFinance.quote(ticker) as any
        if (quote && quote.regularMarketPrice) {
          const price = quote.regularMarketPrice

          await prisma.marketQuote.upsert({
            where: { ticker },
            update: { currentPrice: price, lastUpdatedAt: new Date(), dataSource: 'YAHOO' },
            create: { ticker, currency, currentPrice: price, dataSource: 'YAHOO' },
          })
        }
      } catch (err) {
        console.error(`Failed to fetch quote for ${ticker}:`, err)
      }
    }

    const accounts = await prisma.cashAccount.findMany({ select: { currency: true }, distinct: ['currency'] })
    const users = await prisma.user.findMany({ select: { baseCurrency: true }, distinct: ['baseCurrency'] })

    const allCurrencies = Array.from(new Set([
      ...accounts.map(a => a.currency),
      ...users.map(u => u.baseCurrency),
      ...Array.from(stockMap.values())
    ]))

    for (const curr of allCurrencies) {
      if (curr === 'USD') continue

      try {
        const quote = await yahooFinance.quote(`USD${curr}=X`) as any

        if (quote && quote.regularMarketPrice) {
           const rate = quote.regularMarketPrice

           await prisma.exchangeRate.upsert({
             where: { fromCurrency_toCurrency: { fromCurrency: 'USD', toCurrency: curr } },
             update: { rate },
             create: { fromCurrency: 'USD', toCurrency: curr, rate }
           })

           await prisma.exchangeRate.upsert({
             where: { fromCurrency_toCurrency: { fromCurrency: curr, toCurrency: 'USD' } },
             update: { rate: 1 / rate },
             create: { fromCurrency: curr, toCurrency: 'USD', rate: 1 / rate }
           })
        }
      } catch (err) {
         console.error(`Failed to fetch FX rate for USD${curr}=X:`, err)
      }
    }

    // 🚀 方案 A：報價與匯率更新完成後，統一為所有使用者產生當日淨值快照
    // 使用者之間平行處理，單一使用者失敗不影響其他人
    const snapshotResult = await generateDailySnapshotsForAllUsers()

    return NextResponse.json({
      success: true,
      message: 'Market and FX synced successfully via Yahoo Finance',
      snapshots: snapshotResult
    })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}