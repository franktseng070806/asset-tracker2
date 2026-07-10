// src/lib/financial/cash.ts
import prisma from '@/lib/prisma'

/**
 * 計算單一交割帳戶的即時現金餘額
 * 支援跨幣別交割：股票總價 = (price * shares * settlementFxRate) + fee
 */
export async function calculateAccountBalance(accountId: number): Promise<number> {
  // 1. 取得一般出入金流水 (CashTransactions)
  const cashTx = await prisma.cashTransaction.findMany({
    where: { accountId }
  })
  
  // 計算出入金淨額：入金為正，出金為負
  const cashFlow = cashTx.reduce((sum, tx) => {
    const amount = Number(tx.amount)
    // 假設 type 為 'DEPOSIT' (入金) / 'INITIAL' (期初) 是加項，'WITHDRAWAL' (出金) 是減項
    return tx.type === 'WITHDRAWAL' ? sum - amount : sum + amount
  }, 0)

  // 2. 取得股票交割流水 (StockTransactions)
  const stockTx = await prisma.stockTransaction.findMany({
    where: { accountId },
    include: { marginLoan: true } // 一併拉取融資資料
  })

  // 計算股票交割淨額 (扣款或入帳)
  const stockFlow = stockTx.reduce((sum, tx) => {
    const price = Number(tx.price)
    const shares = Number(tx.shares)
    const fxRate = Number(tx.settlementFxRate)
    const fee = Number(tx.fee)

    // 跨幣別計算核心：總額 = 原生幣別總價 * 交割匯率
    const grossAmount = price * shares * fxRate

    if (tx.tradeType === 'CASH') {
      // 現股交易
      if (tx.action === 'BUY' || tx.action === 'INITIAL') {
        return sum - (grossAmount + fee) // 買入扣款
      } else if (tx.action === 'SELL') {
        return sum + (grossAmount - fee) // 賣出入帳
      }
    } else if (tx.tradeType === 'MARGIN' && tx.marginLoan) {
      // 融資交易：交割帳戶只扣除「自備款」與「手續費」
      const selfPaid = Number(tx.marginLoan.selfPaidAmount)
      if (tx.action === 'BUY') {
         return sum - (selfPaid + fee)
      } else if (tx.action === 'SELL') {
         // 融資賣出：交割帳戶入帳 = 賣出總額 - 手續費 - 償還券商借款本息
         const loanAmount = Number(tx.marginLoan.loanAmount)
         const accruedInterest = Number(tx.marginLoan.accruedInterest)
         return sum + (grossAmount - fee - loanAmount - accruedInterest)
      }
    }
    return sum
  }, 0)

  // 3. 取得轉帳與換匯流水 (Transfers)
  // 轉出 (做為 fromAccount)
  const transfersOut = await prisma.transfer.findMany({
    where: { fromAccountId: accountId }
  })
  const transferOutFlow = transfersOut.reduce((sum, tx) => sum - Number(tx.amount || 0), 0)

  // 轉入 (做為 toAccount)
  const transfersIn = await prisma.transfer.findMany({
    where: { toAccountId: accountId }
  })
  const transferInFlow = transfersIn.reduce((sum, tx) => sum + Number(tx.targetAmount || tx.amount || 0), 0)

  // 4. 結算最終餘額
  return cashFlow + stockFlow + transferOutFlow + transferInFlow
}