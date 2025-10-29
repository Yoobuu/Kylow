import React from 'react'

export default function VMSummaryCards({ summary }) {
  return (
    <div className="flex flex-wrap justify-start gap-4 mb-6">
      <div className="bg-white rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <div className="text-3xl text-gray-600">📦</div>
        <div>
          <h4 className="text-sm text-gray-500">Total de VMs</h4>
          <p className="text-2xl font-bold text-gray-800">{summary.total}</p>
        </div>
      </div>
      <div className="bg-green-100 rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <div className="text-3xl text-green-700">⚡</div>
        <div>
          <h4 className="text-sm text-green-700">Encendidas</h4>
          <p className="text-2xl font-bold text-green-800">{summary.encendidas}</p>
        </div>
      </div>
      <div className="bg-red-100 rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <div className="text-3xl text-red-700">⛔</div>
        <div>
          <h4 className="text-sm text-red-700">Apagadas</h4>
          <p className="text-2xl font-bold text-red-800">{summary.apagadas}</p>
        </div>
      </div>
      <div className="bg-blue-50 rounded-xl shadow p-4 flex-1 min-w-[200px] max-w-[300px]">
        <h4 className="text-sm text-blue-700 mb-2">Por Ambiente</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          {Object.entries(summary.ambientes).map(([amb, count]) => (
            <li key={amb} className="flex justify-between">
              <span>{amb}</span>
              <span className="font-semibold">{count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
