// src/lib/financial/stocks.ts
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type StockTx = Prisma.StockTransactionGetPayload<{}>

export interface Holding {
  ticker: string
  assetCurrency: string
  shares: number
  avgCost: number
}

/**
 * 核心運算：給定單一帳戶（依日期排序）的股票交易紀錄，還原出目前持股
 * 拆成純函式方便單一帳戶版本與批次版本共用同一套邏輯
 */
function computeHoldingsFromTx(transactions: StockTx[]): Holding[] {
  const holdingsMap: Record<string, { shares: number; totalCost: number; assetCurrency: string }> = {}

  for (const tx of transactions) {
    const ticker = tx.ticker
    const shares = Number(tx.shares)
    const price = Number(tx.price)

    if (!holdingsMap[ticker]) {
      holdingsMap[ticker] = { shares: 0, totalCost: 0, assetCurrency: tx.assetCurrency }
    }

    const currentHolding = holdingsMap[ticker]

    if (tx.action === 'INITIAL' || tx.action === 'BUY') {
      currentHolding.shares += shares
      currentHolding.totalCost += shares * price
    } else if (tx.action === 'SELL') {
      if (currentHolding.shares > 0) {
        const currentAvgCost = currentHolding.totalCost / currentHolding.shares
        currentHolding.shares -= shares
        currentHolding.totalCost -= shares * currentAvgCost
      }

      if (currentHolding.shares <= 0.000001) {
        currentHolding.shares = 0
        currentHolding.totalCost = 0
      }
    }
  }

  const finalHoldings: Holding[] = []
  for (const ticker in holdingsMap) {
    const data = holdingsMap[ticker]
    if (data.shares > 0) {
      finalHoldings.push({
        ticker,
        assetCurrency: data.assetCurrency,
        shares: data.shares,
        avgCost: data.totalCost / data.shares,
      })
    }
  }

  return finalHoldings
}

/**
 * 🚀 批次計算【多個帳戶】的持股清單
 * 一次用 accountId IN [...] 撈出所有股票交易，避免每個帳戶各自查一次資料庫
 * 回傳 Map<accountId, Holding[]>
 */
export async function calculateAllAccountHoldings(accountIds: number[]): Promise<Map<number, Holding[]>> {
  if (accountIds.length === 0) return new Map()

  const allTransactions = await prisma.stockTransaction.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: { date: 'asc' },
  })

  const result = new Map<number, Holding[]>()

  for (const accountId of accountIds) {
    const txForAccount = allTransactions.filter(tx => tx.accountId === accountId)
    result.set(accountId, computeHoldingsFromTx(txForAccount))
  }

  return result
}

/**
 * 計算帳戶內各檔股票的即時持股與加權平均成本
 * 保留給只需要算「單一帳戶」的場景使用
 * 內部邏輯與批次版本共用同一套 computeHoldingsFromTx
 */
export async function calculateAccountHoldings(accountId: number): Promise<Holding[]> {
  const holdings = await calculateAllAccountHoldings([accountId])
  return holdings.get(accountId) ?? []
}