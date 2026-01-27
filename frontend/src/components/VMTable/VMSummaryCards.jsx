import React from 'react'
import { FaBox, FaBolt, FaPowerOff } from 'react-icons/fa'

export default function VMSummaryCards({ summary }) {
  return (
    <div className="flex flex-wrap justify-start gap-4 mb-6">
      <div className="bg-[#FAF3E9] rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <FaBox className="text-[2.2rem] text-[#E11B22]" />
        <div>
          <h4 className="text-[1.7rem] leading-tight text-[#E11B22]">Total de VMs</h4>
          <p className="text-[2.1rem] font-bold text-[#231F20]">{summary.total}</p>
        </div>
      </div>
      <div className="bg-[#FAF3E9] rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <FaBolt className="text-[2.2rem] text-[#1B5E20]" />
        <div>
          <h4 className="text-[1.7rem] leading-tight text-[#E11B22]">Encendidas</h4>
          <p className="text-[2.1rem] font-bold text-[#231F20]">{summary.encendidas}</p>
        </div>
      </div>
      <div className="bg-[#FAF3E9] rounded-xl shadow p-4 flex items-center gap-4 flex-1 min-w-[200px] max-w-[300px]">
        <FaPowerOff className="text-[2.2rem] text-[#E11B22]" />
        <div>
          <h4 className="text-[1.7rem] leading-tight text-[#E11B22]">Apagadas</h4>
          <p className="text-[2.1rem] font-bold text-[#231F20]">{summary.apagadas}</p>
        </div>
      </div>
      <div className="bg-[#FAF3E9] rounded-xl shadow p-4 flex-1 min-w-[200px] max-w-[300px]">
        <h4 className="text-[1.7rem] text-[#E11B22] mb-2">Por Ambiente</h4>
        <ul className="text-[1.15rem] text-[#231F20] space-y-1">
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
