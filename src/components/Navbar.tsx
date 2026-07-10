import Navbar from '@/components/Navbar'

import { createClient } from '@/lib/supabase/server'

import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'

import { generateDailySnapshots } from '@/lib/financial/netWorth'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'



export default async function DashboardPage() {

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()



  if (!user) {

    redirect('/login')

  }



  // 1. 檢查使用者是否已在 Prisma 中建檔，若無則自動建立 (預設基準幣別 TWD)

  let dbUser = await prisma.user.findUnique({ where: { id: user.id } })

  if (!dbUser) {

    dbUser = await prisma.user.create({

      data: {

        id: user.id,

        email: user.email!,

        baseCurrency: 'TWD', 

      }

    })

  }



  // 2. 呼叫 Phase 2 打造的無敵結算引擎！

  // 這裡會自動計算所有現金、股票、融資，並換算回 TWD

  const totalNetWorth = await generateDailySnapshots(user.id)



  return (

    <div className="min-h-screen bg-slate-50">

      <Navbar />

      

      <main className="max-w-6xl mx-auto p-6 space-y-6">

        <header className="mb-8">

          <h1 className="text-3xl font-bold text-slate-900">早安！您的資產總覽</h1>

          <p className="text-slate-500 mt-2">這裡是您所有投資與帳戶的最新狀態。</p>

        </header>

        

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* 總資產淨值卡片 */}

          <Card className="border-t-4 border-t-emerald-500 shadow-sm">

            <CardHeader className="pb-2">

              <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">

                總資產淨值 ({dbUser.baseCurrency})

              </CardTitle>

            </CardHeader>

            <CardContent>

              <p className="text-4xl font-bold text-slate-900">

                ${totalNetWorth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}

              </p>

            </CardContent>

          </Card>

          

          {/* 預留給未來擴充的卡片 */}

          <Card className="shadow-sm">

            <CardHeader className="pb-2">

              <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">總投入本金</CardTitle>

            </CardHeader>

            <CardContent>

              <p className="text-2xl font-semibold text-slate-400">尚無資料</p>

            </CardContent>

          </Card>



          <Card className="shadow-sm">

            <CardHeader className="pb-2">

              <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">未實現損益</CardTitle>

            </CardHeader>

            <CardContent>

              <p className="text-2xl font-semibold text-slate-400">尚無資料</p>

            </CardContent>

          </Card>

        </div>

      </main>

    </div>

  )

}