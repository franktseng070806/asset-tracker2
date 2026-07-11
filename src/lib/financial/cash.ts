// src/lib/financial/cash.ts
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type CashTx = Prisma.CashTransactionGetPayload<{}>
type StockTx = Prisma.StockTransactionGetPayload<{ include: { marginLoan: true } }>
type TransferTx = Prisma.TransferGetPayload<{}>

/**
 * 核心運算：給定單一帳戶的交易資料，算出現金餘額
 * 拆成純函式方便單一帳戶版本與批次版本共用同一套邏輯
 */
function computeBalanceFromTx(
  accountId: number,
  cashTx: CashTx[],
  stockTx: StockTx[],
  transfersOut: TransferTx[],
  transfersIn: TransferTx[]
): number {
  // 1. 一般出入金流水
  const cashFlow = cashTx.reduce((sum, tx) => {
    const amount = Number(tx.amount)
    return tx.type === 'WITHDRAWAL' ? sum - amount : sum + amount
  }, 0)

  // 2. 股票交割流水
  const stockFlow = stockTx.reduce((sum, tx) => {
    const price = Number(tx.price)
    const shares = Number(tx.shares)
    const fxRate = Number(tx.settlementFxRate)
    const fee = Number(tx.fee)
    const grossAmount = price * shares * fxRate

    if (tx.tradeType === 'CASH') {
      if (tx.action === 'BUY' || tx.action === 'INITIAL') {
        return sum - (grossAmount + fee)
      } else if (tx.action === 'SELL') {
        return sum + (grossAmount - fee)
      }
    } else if (tx.tradeType === 'MARGIN' && tx.marginLoan) {
      const selfPaid = Number(tx.marginLoan.selfPaidAmount)
      if (tx.action === 'BUY') {
        return sum - (selfPaid + fee)
      } else if (tx.action === 'SELL') {
        const loanAmount = Number(tx.marginLoan.loanAmount)
        const accruedInterest = Number(tx.marginLoan.accruedInterest)
        return sum + (grossAmount - fee - loanAmount - accruedInterest)
      }
    }
    return sum
  }, 0)

  // 3. 轉帳與換匯流水
  const transferOutFlow = transfersOut.reduce((sum, tx) => sum - Number(tx.amount || 0), 0)
  const transferInFlow = transfersIn.reduce((sum, tx) => sum + Number(tx.targetAmount || tx.amount || 0), 0)

  return cashFlow + stockFlow + transferOutFlow + transferInFlow
}

/**
 * 🚀 批次計算【多個帳戶】的即時現金餘額
 * 一次用 accountId IN [...] 撈出所有相關交易，避免每個帳戶各自查 4 次資料庫
 * 回傳 Map<accountId, balance>
 */
export async function calculateAllAccountBalances(accountIds: number[]): Promise<Map<number, number>> {
  if (accountIds.length === 0) return new Map()

  const [allCashTx, allStockTx, allTransfersOut, allTransfersIn] = await Promise.all([
    prisma.cashTransaction.findMany({ where: { accountId: { in: accountIds } } }),
    prisma.stockTransaction.findMany({
      where: { accountId: { in: accountIds } },
      include: { marginLoan: true }
    }),
    prisma.transfer.findMany({ where: { fromAccountId: { in: accountIds } } }),
    prisma.transfer.findMany({ where: { toAccountId: { in: accountIds } } }),
  ])

  const result = new Map<number, number>()

  for (const accountId of accountIds) {
    const cashTx = allCashTx.filter(tx => tx.accountId === accountId)
    const stockTx = allStockTx.filter(tx => tx.accountId === accountId)
    const transfersOut = allTransfersOut.filter(tx => tx.fromAccountId === accountId)
    const transfersIn = allTransfersIn.filter(tx => tx.toAccountId === accountId)

    result.set(accountId, computeBalanceFromTx(accountId, cashTx, stockTx, transfersOut, transfersIn))
  }

  return result
}

/**
 * 計算單一交割帳戶的即時現金餘額
 * 保留給只需要算「單一帳戶」的場景使用（例如新增一筆交易後即時重算該帳戶）
 * 內部邏輯與批次版本共用同一套 computeBalanceFromTx
 */
export async function calculateAccountBalance(accountId: number): Promise<number> {
  const balances = await calculateAllAccountBalances([accountId])
  return balances.get(accountId) ?? 0
}