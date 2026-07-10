// src/lib/financial/margin.ts
import prisma from '@/lib/prisma'

export interface MarginLoanStatus {
  loanId: number
  ticker: string
  loanCurrency: string
  loanAmount: number          // 借款本金
  accruedInterest: number     // 累計利息
  totalDebt: number           // 總負債 (本金 + 利息)
  loanShares: number          // 融資買進的股數
  currentPrice: number        // 最新股價 (從行情表取得)
  marketValue: number         // 股票最新市值 (以借款幣別計價)
  maintenanceRatio: number    // 維持率 (%)
}

/**
 * 計算單一帳戶內所有「未平倉 (OPEN)」的融資狀態與維持率
 * [跨幣功能]：維持率計算 = (即時股價 * 融資股數) / 借款本金
 */
export async function calculateMarginStatus(accountId: number): Promise<MarginLoanStatus[]> {
  // 1. 取得該帳戶所有尚未還清 (OPEN) 的融資紀錄
  const openLoans = await prisma.marginLoan.findMany({
    where: { 
      accountId,
      status: 'OPEN' 
    }
  })

  if (openLoans.length === 0) return []

  const marginStatuses: MarginLoanStatus[] = []

  // 2. 逐筆計算每筆融資的即時維持率
  for (const loan of openLoans) {
    const ticker = loan.ticker
    const loanAmount = Number(loan.loanAmount)
    const accruedInterest = Number(loan.accruedInterest)
    const loanShares = Number(loan.loanShares)
    const totalDebt = loanAmount + accruedInterest

    // 嘗試從資料庫取得最新報價 (如果還沒排程抓取，預設為 0)
    const quote = await prisma.marketQuote.findUnique({
      where: { ticker }
    })
    
    // 如果沒有報價，為了避免報錯，價格先以 0 計算
    const currentPrice = quote ? Number(quote.currentPrice) : 0
    let marketValue = currentPrice * loanShares

    // [跨幣別檢測]
    // 如果股票的計價幣別 (quote.currency) 與 融資借款幣別 (loan.loanCurrency) 不同
    // 必須將市值換算回借款幣別，才能算出正確的維持率
    if (quote && quote.currency !== loan.loanCurrency) {
      const fx = await prisma.exchangeRate.findUnique({
        where: {
          fromCurrency_toCurrency: {
            fromCurrency: quote.currency,
            toCurrency: loan.loanCurrency
          }
        }
      })
      const rate = fx ? Number(fx.rate) : 1 // 若找不到匯率暫以 1 計算
      marketValue = marketValue * rate
    }

    // 計算維持率：(市值 / 借款本金) * 100
    // 注意：業界維持率通常只看本金，有些券商會算入利息，我們這裡採標準 (市值/本金)
    const maintenanceRatio = loanAmount > 0 ? (marketValue / loanAmount) * 100 : 0

    marginStatuses.push({
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
    })
  }

  return marginStatuses
}