// src/app/api/cron/market-sync/route.ts
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import yahooFinance from 'yahoo-finance2'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  // 1. 安全防護：確認呼叫者帶有正確的密鑰
  const authHeader = request.headers.get('authorization')
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ==========================================
    // [Part 1: 股票行情同步 (統一使用 Yahoo Finance)]
    // ==========================================
    
    // 從資料庫撈出所有「有交易紀錄」的股票代號
    const txTickers = await prisma.stockTransaction.findMany({ 
      select: { ticker: true, assetCurrency: true }, 
      distinct: ['ticker'] 
    })
    
    // 整理成 Map 確保不重複
    const stockMap = new Map<string, string>()
    txTickers.forEach(t => stockMap.set(t.ticker, t.assetCurrency))

    for (const [ticker, currency] of stockMap.entries()) {
      try {
        const quote = await yahooFinance.quote(ticker) as any
        if (quote && quote.regularMarketPrice) {
          const price = quote.regularMarketPrice
          
          // 更新或建立快取
          await prisma.marketQuote.upsert({
            where: { ticker },
            update: { currentPrice: price, lastUpdatedAt: new Date(), dataSource: 'YAHOO' },
            create: { ticker, currency, currentPrice: price, dataSource: 'YAHOO' },
          })
        }
      } catch (err) {
        console.error(`Failed to fetch quote for ${ticker}:`, err)
        // 繼續執行下一檔，不中斷
      }
    }

    // ==========================================
    // [Part 2: 外匯交叉匯率同步]
    // ==========================================
    
    // 動態掃描系統中所有涉及的幣別
    const accounts = await prisma.cashAccount.findMany({ select: { currency: true }, distinct: ['currency'] })
    const users = await prisma.user.findMany({ select: { baseCurrency: true }, distinct: ['baseCurrency'] })
    
    const allCurrencies = Array.from(new Set([
      ...accounts.map(a => a.currency),
      ...users.map(u => u.baseCurrency),
      ...Array.from(stockMap.values())
    ]))

    for (const curr of allCurrencies) {
      if (curr === 'USD') continue // USD 對 USD 不需抓取
      
      try {
        const quote = await yahooFinance.quote(`USD${curr}=X`) as any
        
        if (quote && quote.regularMarketPrice) {
           const rate = quote.regularMarketPrice
           
           // 儲存 USD -> 目標幣別
           await prisma.exchangeRate.upsert({
             where: { fromCurrency_toCurrency: { fromCurrency: 'USD', toCurrency: curr } },
             update: { rate },
             create: { fromCurrency: 'USD', toCurrency: curr, rate }
           })

           // 同步儲存 目標幣別 -> USD (倒數計算)
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

    return NextResponse.json({ success: true, message: 'Market and FX synced successfully via Yahoo Finance' })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}