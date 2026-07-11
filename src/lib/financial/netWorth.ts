// src/lib/financial/netWorth.ts
import prisma from '@/lib/prisma'
import { calculateAllAccountBalances } from './cash'
import { calculateAllAccountHoldings } from './stocks'
import { calculateAllMarginStatus, type MarketQuoteInfo } from './margin'

/**
 * 🚀 一次性撈取全部報價與匯率，轉成記憶體查表用的 Map
 * MarketQuote / ExchangeRate 是全域共用資料，筆數不會隨使用者數量增加，
 * 一次撈完即可讓後續所有計算都改成查記憶體，不用再逐筆打資料庫
 */
async function loadQuotesAndRates() {
  const [quotes, rates] = await Promise.all([
    prisma.marketQuote.findMany(),
    prisma.exchangeRate.findMany(),
  ])

  const quotesMap = new Map<string, MarketQuoteInfo>(
    quotes.map(q => [q.ticker, { currentPrice: Number(q.currentPrice), currency: q.currency }])
  )

  const ratesMap = new Map<string, number>(
    rates.map(r => [`${r.fromCurrency}_${r.toCurrency}`, Number(r.rate)])
  )

  return { quotesMap, ratesMap }
}

/**
 * 查記憶體 Map 取得匯率，取代原本每次都 await prisma.exchangeRate.findUnique(...)
 */
function getFxRateFromMap(from: string, to: string, ratesMap: Map<string, number>): number {
  if (from === to) return 1
  return ratesMap.get(`${from}_${to}`) ?? 1
}

/**
 * 輔助函數：若同一天重複觸發，則更新 (取代舊版 delete 後再 insert 的做法)
 */
async function upsertSnapshot(userId: string, date: Date, netWorth: number, scopeType: string, accountId: number | null = null) {
  const snapshotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

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

export interface AccountNetWorthResult {
  accountId: number
  netWorth: number
  cashValueInBase: number
  stocksValueInBase: number
  debtValueInBase: number
}

/**
 * 🚀 批次計算【一個使用者名下所有帳戶】的淨值
 * 一次撈取報價、匯率、餘額、持股、融資，之後全部在記憶體中組合計算，
 * 取代過去「每個帳戶、每筆持股、每筆融資都各自查一次資料庫」的寫法
 */
export async function calculateAllAccountsNetWorth(
  accountIds: number[],
  accountCurrencyMap: Map<number, string>,
  baseCurrency: string
): Promise<AccountNetWorthResult[]> {
  if (accountIds.length === 0) return []

  const { quotesMap, ratesMap } = await loadQuotesAndRates()

  const [balances, holdings, margins] = await Promise.all([
    calculateAllAccountBalances(accountIds),
    calculateAllAccountHoldings(accountIds),
    calculateAllMarginStatus(accountIds, quotesMap, ratesMap),
  ])

  return accountIds.map(accountId => {
    const accountCurrency = accountCurrencyMap.get(accountId) ?? baseCurrency

    // 現金
    const cashBalance = balances.get(accountId) ?? 0
    const cashFxRate = getFxRateFromMap(accountCurrency, baseCurrency, ratesMap)
    const cashValueInBase = cashBalance * cashFxRate

    // 持股
    const accountHoldings = holdings.get(accountId) ?? []
    let stocksValueInBase = 0
    for (const h of accountHoldings) {
      const quote = quotesMap.get(h.ticker)
      const currentPrice = quote ? quote.currentPrice : h.avgCost
      const holdingFxRate = getFxRateFromMap(h.assetCurrency, baseCurrency, ratesMap)
      stocksValueInBase += (currentPrice * h.shares) * holdingFxRate
    }

    // 融資負債
    const accountMargins = margins.get(accountId) ?? []
    let debtValueInBase = 0
    for (const m of accountMargins) {
      const loanFxRate = getFxRateFromMap(m.loanCurrency, baseCurrency, ratesMap)
      debtValueInBase += m.totalDebt * loanFxRate
    }

    return {
      accountId,
      netWorth: cashValueInBase + stocksValueInBase - debtValueInBase,
      cashValueInBase,
      stocksValueInBase,
      debtValueInBase,
    }
  })
}

/**
 * 計算【單一帳戶】的即時淨值 (統一折算為使用者的 baseCurrency)
 * 保留給只需要算「單一帳戶」的場景使用，內部共用批次版本邏輯
 */
export async function calculateAccountNetWorth(accountId: number, baseCurrency: string): Promise<number> {
  const account = await prisma.cashAccount.findUnique({ where: { id: accountId } })
  if (!account) return 0

  const results = await calculateAllAccountsNetWorth(
    [accountId],
    new Map([[accountId, account.currency]]),
    baseCurrency
  )

  return results[0]?.netWorth ?? 0
}

/**
 * 🚀 核心業務：產生並儲存【單一使用者】的「全範圍快照」
 * 包含：各個交割帳戶快照 (account) -> 總淨值快照 (total)
 *
 * ⚠️ 此函式只由 /api/cron/market-sync 排程呼叫，不再於頁面請求中同步觸發。
 * 帳戶淨值改用批次函式一次算完，不再逐帳戶查詢報價與匯率。
 */
export async function generateDailySnapshots(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  const baseCurrency = user.baseCurrency
  const today = new Date()

  const banks = await prisma.bank.findMany({
    where: { userId },
    include: { accounts: true }
  })

  const allAccounts = banks.flatMap(b => b.accounts)
  const accountIds = allAccounts.map(a => a.id)
  const accountCurrencyMap = new Map(allAccounts.map(a => [a.id, a.currency]))

  const accountResults = await calculateAllAccountsNetWorth(accountIds, accountCurrencyMap, baseCurrency)

  // 平行寫入帳戶級別快照
  await Promise.all(
    accountResults.map(r => upsertSnapshot(userId, today, r.netWorth, 'account', r.accountId))
  )

  const totalNetWorth = accountResults.reduce((sum, r) => sum + r.netWorth, 0)

  await upsertSnapshot(userId, today, totalNetWorth, 'total', null)

  return totalNetWorth
}

/**
 * 🚀 批次為【所有使用者】產生每日快照，供 cron 排程呼叫
 * 使用者之間彼此獨立，用 Promise.allSettled 並行處理，
 * 單一使用者失敗不會影響其他使用者的快照產生
 */
export async function generateDailySnapshotsForAllUsers() {
  const users = await prisma.user.findMany({ select: { id: true } })

  const results = await Promise.allSettled(
    users.map(u => generateDailySnapshots(u.id))
  )

  const failed = results
    .map((r, i) => ({ result: r, userId: users[i].id }))
    .filter(({ result }) => result.status === 'rejected')

  failed.forEach(({ userId, result }) => {
    if (result.status === 'rejected') {
      console.error(`Failed to generate snapshot for user ${userId}:`, result.reason)
    }
  })

  return {
    total: users.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: failed.length
  }
}