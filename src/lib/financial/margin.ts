// src/lib/financial/margin.ts
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type MarginLoanRow = Prisma.MarginLoanGetPayload<{}>

export interface MarketQuoteInfo {
  currentPrice: number
  currency: string
}

export interface MarginLoanStatus {
  loanId: number
  ticker: string
  loanCurrency: string
  loanAmount: number
  accruedInterest: number
  totalDebt: number
  loanShares: number
  currentPrice: number
  marketValue: number
  maintenanceRatio: number
}

/**
 * 核心運算：給定融資紀錄與（已經批次撈好的）報價 / 匯率 Map，算出維持率狀態
 * 不再對資料庫發送任何查詢，全部透過記憶體 Map 查表
 */
function computeMarginStatus(
  loan: MarginLoanRow,
  quotesMap: Map<string, MarketQuoteInfo>,
  ratesMap: Map<string, number>
): MarginLoanStatus {
  const ticker = loan.ticker
  const loanAmount = Number(loan.loanAmount)
  const accruedInterest = Number(loan.accruedInterest)
  const loanShares = Number(loan.loanShares)
  const totalDebt = loanAmount + accruedInterest

  const quote = quotesMap.get(ticker)
  const currentPrice = quote ? quote.currentPrice : 0
  let marketValue = currentPrice * loanShares

  // 跨幣別檢測：若報價幣別與借款幣別不同，換算回借款幣別
  if (quote && quote.currency !== loan.loanCurrency) {
    const rateKey = `${quote.currency}_${loan.loanCurrency}`
    const rate = ratesMap.get(rateKey) ?? 1
    marketValue = marketValue * rate
  }

  const maintenanceRatio = loanAmount > 0 ? (marketValue / loanAmount) * 100 : 0

  return {
    loanId: loan.id,
    ticker,
    loanCurrency: loan.loanCurrency,
    loanAmount,
    accruedInterest,
    totalDebt,
    loanShares,
    currentPrice,
    marketValue,
    maintenanceRatio
  }
}

/**
 * 🚀 批次計算【多個帳戶】所有未平倉融資的狀態
 * 一次用 accountId IN [...] 撈出所有融資紀錄，並吃外部傳入的 quotesMap / ratesMap，
 * 避免每筆融資各自查一次報價、查一次匯率
 * 回傳 Map<accountId, MarginLoanStatus[]>
 */
export async function calculateAllMarginStatus(
  accountIds: number[],
  quotesMap: Map<string, MarketQuoteInfo>,
  ratesMap: Map<string, number>
): Promise<Map<number, MarginLoanStatus[]>> {
  if (accountIds.length === 0) return new Map()

  const allLoans = await prisma.marginLoan.findMany({
    where: {
      accountId: { in: accountIds },
      status: 'OPEN'
    }
  })

  const result = new Map<number, MarginLoanStatus[]>()

  for (const accountId of accountIds) {
    const loansForAccount = allLoans.filter(l => l.accountId === accountId)
    const statuses = loansForAccount.map(loan => computeMarginStatus(loan, quotesMap, ratesMap))
    result.set(accountId, statuses)
  }

  return result
}

/**
 * 計算單一帳戶內所有未平倉融資的狀態
 * 保留給只需要算「單一帳戶」的場景使用
 * 內部會自行撈取該帳戶相關的報價與匯率（範圍小，僅限用得到的 ticker / 幣別）
 */
export async function calculateMarginStatus(accountId: number): Promise<MarginLoanStatus[]> {
  const openLoans = await prisma.marginLoan.findMany({
    where: { accountId, status: 'OPEN' }
  })

  if (openLoans.length === 0) return []

  const tickers = Array.from(new Set(openLoans.map(l => l.ticker)))
  const quotes = await prisma.marketQuote.findMany({ where: { ticker: { in: tickers } } })
  const quotesMap = new Map<string, MarketQuoteInfo>(
    quotes.map(q => [q.ticker, { currentPrice: Number(q.currentPrice), currency: q.currency }])
  )

  const currencyPairs = new Set<string>()
  for (const loan of openLoans) {
    const quote = quotesMap.get(loan.ticker)
    if (quote && quote.currency !== loan.loanCurrency) {
      currencyPairs.add(`${quote.currency}_${loan.loanCurrency}`)
    }
  }

  const ratesMap = new Map<string, number>()
  if (currencyPairs.size > 0) {
    const allRates = await prisma.exchangeRate.findMany()
    for (const pair of currencyPairs) {
      const [from, to] = pair.split('_')
      const rate = allRates.find(r => r.fromCurrency === from && r.toCurrency === to)
      if (rate) ratesMap.set(pair, Number(rate.rate))
    }
  }

  return openLoans.map(loan => computeMarginStatus(loan, quotesMap, ratesMap))
}