import React from 'react'

export default function VMEmptyState({ type, onResetFilters }) {
  const messages = {
    filtered: {
      title: 'No hay resultados con los filtros aplicados.',
      action: 'Limpiar filtros',
    },
    empty: {
      title: 'No hay máquinas virtuales registradas.',
    },
    error: {
      title: 'Ocurrió un error al cargar las VMs.',
    },
  }

  const message = messages[type] || messages.empty

  return (
    <div className="text-center py-20 bg-white rounded-xl shadow-sm">
      <p className="text-gray-600 mb-4">{message.title}</p>
      {message.action && onResetFilters && (
        <button
          onClick={onResetFilters}
          className="bg-[#5da345] text-white font-medium py-2 px-4 rounded-lg shadow hover:bg-[#4c8c38] transition"
        >
          {message.action}
        </button>
      )}
    </div>
  )
}
