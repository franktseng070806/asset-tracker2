// src/lib/financial/netWorth.ts
import prisma from '@/lib/prisma'
import { calculateAccountBalance } from './cash'
import { calculateAccountHoldings } from './stocks'
import { calculateMarginStatus } from './margin'

/**
 * 輔助函數：取得任意幣別轉換為「系統基準幣別」的最新匯率
 */
async function getFxRateToBase(fromCurrency: string, baseCurrency: string): Promise<number> {
  if (fromCurrency === baseCurrency) return 1
  
  const fx = await prisma.exchangeRate.findUnique({
    where: {
      fromCurrency_toCurrency: {
        fromCurrency,
        toCurrency: baseCurrency
      }
    }
  })
  
  // 實務上我們會在 Phase 3 確保匯率表隨時更新，若極端情況找不到，暫以 1 計算避免報錯
  return fx ? Number(fx.rate) : 1
}

/**
 * 計算【單一帳戶】的即時淨值 (統一折算為使用者的 baseCurrency)
 */
export async function calculateAccountNetWorth(accountId: number, baseCurrency: string): Promise<number> {
  const account = await prisma.cashAccount.findUnique({ where: { id: accountId } })
  if (!account) return 0

  // 1. 取得現金餘額並轉換匯率
  const cashBalance = await calculateAccountBalance(accountId)
  const cashFxRate = await getFxRateToBase(account.currency, baseCurrency)
  const cashValueInBase = cashBalance * cashFxRate

  // 2. 取得持股並轉換市值
  const holdings = await calculateAccountHoldings(accountId)
  let stocksValueInBase = 0
  for (const h of holdings) {
    const quote = await prisma.marketQuote.findUnique({ where: { ticker: h.ticker } })
    const currentPrice = quote ? Number(quote.currentPrice) : h.avgCost // 若無報價暫以成本計
    
    // 股票市值 = (原生幣別股價 * 股數) * 換算回基準幣別的匯率
    const holdingFxRate = await getFxRateToBase(h.assetCurrency, baseCurrency)
    stocksValueInBase += (currentPrice * h.shares) * holdingFxRate
  }

  // 3. 取得融資負債並轉換
  const marginLoans = await calculateMarginStatus(accountId)
  let debtValueInBase = 0
  for (const m of marginLoans) {
    const loanFxRate = await getFxRateToBase(m.loanCurrency, baseCurrency)
    debtValueInBase += m.totalDebt * loanFxRate
  }

  // 淨值 = 現金 + 股票市值 - 融資負債
  return cashValueInBase + stocksValueInBase - debtValueInBase
}

/**
 * 🚀 核心業務：產生並儲存使用者的「全範圍快照」(完美取代舊版 save_snapshot)
 * 包含：各個交割帳戶快照 (account) -> 各個銀行快照 (bank) -> 總淨值快照 (total)
 */
export async function generateDailySnapshots(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')
  
  const baseCurrency = user.baseCurrency
  const today = new Date()

  // 取得使用者所有銀行與帳戶
  const banks = await prisma.bank.findMany({
    where: { userId },
    include: { accounts: true }
  })

  let totalNetWorth = 0

  for (const bank of banks) {
    let bankNetWorth = 0

    // [範圍 1：單一交割帳戶 (Account)]
    for (const account of bank.accounts) {
      const accountNetWorth = await calculateAccountNetWorth(account.id, baseCurrency)
      bankNetWorth += accountNetWorth

      // 儲存帳戶級別快照
      await upsertSnapshot(userId, today, accountNetWorth, 'account', account.id)
    }

    // [範圍 2：銀行總和 (Bank)]
    totalNetWorth += bankNetWorth
    // 如果未來介面需要顯示單一銀行的總和，也可在這裡儲存 bank 級別快照
    // await upsertSnapshot(userId, today, bankNetWorth, 'bank')
  }

  // [範圍 3：全資產總淨值 (Total)]
  await upsertSnapshot(userId, today, totalNetWorth, 'total', null)

  return totalNetWorth
}

/**
 * 輔助函數：若同一天重複觸發，則更新 (取代舊版 delete 後再 insert 的做法)
 */
async function upsertSnapshot(userId: string, date: Date, netWorth: number, scopeType: string, accountId: number | null = null) {
  // 建立當日 00:00:00 的時間戳記，確保同一天只有一筆
  const snapshotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // 尋找是否已有今天的紀錄
  const existing = await prisma.netWorthSnapshot.findFirst({
    where: { userId, date: snapshotDate, scopeType, accountId }
  })

  if (existing) {
    await prisma.netWorthSnapshot.update({
      where: { id: existing.id },
      data: { netWorth }
    })
  } else {
    await prisma.netWorthSnapshot.create({
      data: { userId, date: snapshotDate, netWorth, scopeType, accountId }
    })
  }
}