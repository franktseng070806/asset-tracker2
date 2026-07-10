'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

// 設定高質感的資產配色
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b']

export default function AssetChart({ data }: { data: { name: string, value: number }[] }) {
  // 過濾掉金額為 0 或負數的資料
  const chartData = data.filter(d => d.value > 0)

  if (chartData.length === 0) {
    return <div className="h-[300px] flex items-center justify-center text-slate-400">尚無資產數據</div>
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            formatter={(value: any) => `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}