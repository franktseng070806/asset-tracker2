// src/lib/financial/stocks.ts
import prisma from '@/lib/prisma'

export interface Holding {
  ticker: string
  assetCurrency: string
  shares: number
  avgCost: number // 原生幣別的加權平均成本
}

/**
 * 計算帳戶內各檔股票的即時持股與加權平均成本
 * [跨幣功能]：均價統一以「標的原生幣別（assetCurrency）」計算，不受交割匯率波動干擾
 */
export async function calculateAccountHoldings(accountId: number): Promise<Holding[]> {
  // 1. 取得該帳戶所有歷史股票交易 (依日期嚴格排序，這對加權平均非常重要)
  const transactions = await prisma.stockTransaction.findMany({
    where: { accountId },
    orderBy: { date: 'asc' },
  })

  // 暫存每檔股票的計算狀態 (記憶體內運算)
  const holdingsMap: Record<string, { shares: number; totalCost: number; assetCurrency: string }> = {}

  // 2. 時間軸推演：一筆一筆還原歷史交易
  for (const tx of transactions) {
    const ticker = tx.ticker
    const shares = Number(tx.shares)
    const price = Number(tx.price) // 標的原生幣別價格

    // 如果是第一次買這檔股票，在字典裡開一個新空間
    if (!holdingsMap[ticker]) {
      holdingsMap[ticker] = { shares: 0, totalCost: 0, assetCurrency: tx.assetCurrency }
    }

    const currentHolding = holdingsMap[ticker]

    if (tx.action === 'INITIAL' || tx.action === 'BUY') {
      // 買進：增加股數與總成本 (只看原生幣別)
      currentHolding.shares += shares
      currentHolding.totalCost += shares * price
    } else if (tx.action === 'SELL') {
      // 賣出：先算出「賣出當下的均價」，再依均價扣除成本
      if (currentHolding.shares > 0) {
        const currentAvgCost = currentHolding.totalCost / currentHolding.shares
        currentHolding.shares -= shares
        currentHolding.totalCost -= shares * currentAvgCost
      }
      
      // 避免浮點數誤差導致股票賣光了卻還殘留 0.00000001 股
      if (currentHolding.shares <= 0.000001) {
        currentHolding.shares = 0
        currentHolding.totalCost = 0
      }
    }
  }

  // 3. 整理輸出最終持股清單 (過濾掉已經賣光、股數為 0 的股票)
  const finalHoldings: Holding[] = []
  for (const ticker in holdingsMap) {
    const data = holdingsMap[ticker]
    if (data.shares > 0) {
      finalHoldings.push({
        ticker,
        assetCurrency: data.assetCurrency,
        shares: data.shares,
        // 最終均價 = 總成本 / 總股數
        avgCost: data.totalCost / data.shares, 
      })
    }
  }

  return finalHoldings
}