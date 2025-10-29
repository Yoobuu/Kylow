import React from 'react'
import { AnimatePresence, motion as Motion } from 'framer-motion'

import LoadingThreeDotsJumping from '../LoadingThreeDotsJumping'

function inferClusterFromHost(obj) {
  const hvhost =
    obj.HVHost ||
    obj.host ||
    obj.HVHOST ||
    obj.hypervHost ||
    ''

  if (typeof hvhost === 'string' && hvhost.length > 0) {
    const first = hvhost[0].toUpperCase()
    if (first === 'S') return 'sandbox'
    if (first === 'T') return 'test'
    if (first === 'P') return 'produccion'
  }

  return null
}

const groupVariants = {
  open: {
    opacity: 1,
    height: 'auto',
    transition: { duration: 0.3 },
  },
  collapsed: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.25 },
  },
}

const renderCellFallback = (value) => {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—'
  }
  if (value == null || value === '') {
    return '—'
  }
  return value
}

export default function VMGroupsTable({
  columns,
  entries,
  groupByOption,
  collapsedGroups,
  toggleGroup,
  sortBy,
  onHeaderClick,
  onRowClick,
  loading,
}) {
  if (loading) {
    return (
      <div className="py-16 px-6 flex flex-col items-center justify-center gap-4 bg-white rounded-xl shadow-sm text-center">
        <LoadingThreeDotsJumping />
        <p className="text-sm text-gray-600 max-w-md">
          Cargando inventario de Hyper-V. Este proceso puede tardar varios minutos cuando se consulta por primera vez o se fuerza un refresco.
        </p>
      </div>
    )
  }

  return (
    <>
      {entries.map(([groupName, list]) => (
        <div key={groupName} className="mb-10 bg-white rounded-xl shadow-md overflow-hidden">
          {groupByOption !== 'none' && (
            <div
              className="bg-gray-800 px-6 py-4 cursor-pointer select-none flex items-center justify-between"
              onClick={() => toggleGroup(groupName)}
            >
              <h3 className="text-xl font-bold text-white">{groupName || 'Sin grupo'}</h3>
              <span className="text-white text-lg">
                {collapsedGroups[groupName] ? '▶' : '▼'}
              </span>
            </div>
          )}

          <AnimatePresence initial={false}>
            {!collapsedGroups[groupName] && (
              <Motion.div
                key="content"
                variants={groupVariants}
                initial="collapsed"
                animate="open"
                exit="collapsed"
                className="overflow-x-auto overflow-y-auto"
                style={{ originY: 0 }}
              >
                <div className="max-h-[600px]">
                  <table className="w-full table-auto border-collapse">
                    <thead className="bg-gray-100 sticky top-0 z-10">
                      <tr>
                        {columns.map((col) => (
                          <th
                            key={col.key}
                            className="px-6 py-4 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 transition"
                            onClick={() => onHeaderClick(col.key)}
                          >
                            <div className="flex items-center">
                              {col.label}
                              {sortBy.key === col.key ? (
                                <span className="ml-1">{sortBy.asc ? '▲' : '▼'}</span>
                              ) : (
                                <span className="ml-1 text-gray-400">↕</span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {list.map((vm) => {
                        const vmOriginal = (vm && (vm.__original || vm.original)) || vm
                        const vmForRenderBase = (vm && (vm.__display || vm.display)) || vm
                        const clusterExplicit =
                          vm.Cluster ||
                          vm.cluster ||
                          vm.ClusterName ||
                          null

                        const clusterDerived = inferClusterFromHost(vm)
                        const clusterDisplay = clusterExplicit || clusterDerived || '—'
                        const vmForRender = {
                          ...vmForRenderBase,
                          cluster: clusterDisplay,
                        }
                        return (
                          <tr
                            key={vm.id}
                            className="odd:bg-white even:bg-gray-50 hover:bg-gray-50 cursor-pointer transition"
                            onClick={() => {
                              console.log('[VMGroupsTable row click] vmOriginal =', vmOriginal)
                              onRowClick(vmOriginal)
                            }}
                          >
                            {columns.map((col) => (
                              <td key={col.key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                {col.render ? col.render(vmForRender) : renderCellFallback(vmForRender[col.key])}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                      {list.length === 0 && (
                        <tr>
                          <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                            Sin resultados
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </>
  )
}
