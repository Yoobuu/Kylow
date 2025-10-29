import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import api from '../api/axios'
import { IoPowerSharp, IoPowerOutline, IoRefreshSharp } from 'react-icons/io5'

const ACTION_THEMES = {
  start: {
    base: 'bg-green-500 hover:bg-green-600 focus-visible:ring-green-300',
  },
  stop: {
    base: 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-300',
  },
  reset: {
    base: 'bg-yellow-500 hover:bg-yellow-600 focus-visible:ring-yellow-300',
  },
}

const SKELETON_WIDTHS = ['w-2/3', 'w-1/2', 'w-5/6', 'w-3/4', 'w-1/3', 'w-2/5']

const renderDisksWithBars = (disks) => {
  if (!Array.isArray(disks) || disks.length === 0) {
    return '\u2014'
  }

  const items = disks
    .map((disk) => {
      if (!disk) return null
      if (typeof disk === 'object' && ('text' in disk || 'pct' in disk)) {
        const textValue = disk.text ?? ''
        if (!textValue) return null
        const pctValue =
          disk.pct != null && Number.isFinite(Number(disk.pct)) ? Number(disk.pct) : null
        return { text: textValue, pct: pctValue }
      }
      if (typeof disk === 'string') {
        const match = /([\d.,]+)%/.exec(disk)
        const pctValue = match ? Number(match[1].replace(',', '.')) : null
        return { text: disk, pct: Number.isFinite(pctValue) ? pctValue : null }
      }
      return { text: String(disk), pct: null }
    })
    .filter((disk) => disk && disk.text)

  if (!items.length) {
    return '\u2014'
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((disk, index) => {
        const hasPct = Number.isFinite(disk.pct)
        const pctNumber = hasPct ? disk.pct : 0
        const width = hasPct ? Math.min(Math.max(pctNumber, 0), 100) : 0
        const barColor =
          hasPct && pctNumber < 50
            ? 'bg-green-500'
            : hasPct && pctNumber < 80
              ? 'bg-yellow-500'
              : hasPct
                ? 'bg-red-500'
                : 'bg-green-500'
        return (
          <div key={index} className="flex flex-col gap-1">
            <span className="text-sm text-gray-700">{disk.text}</span>
            {hasPct && (
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColor} rounded-full transition-all duration-300`}
                  style={{ width: `${width}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function VMDetailModal({ vmId, onClose, onAction }) {
  // —————— Estados locales y referencias ——————
  // loading           → controla la carga inicial del detalle
  // detail            → guarda los datos de la VM obtenidos
  // error             → muestra errores al cargar el detalle
  // actionLoading     → indica qué acción de power está en curso
  // pending           → almacena la acción pendiente de confirmación
  // successMsg        → mensaje de éxito tras completar una acción
  // modalRef          → referencia para el trap de foco y cierre con Esc
  const [loading, setLoading]             = useState(true)
  const [detail, setDetail]               = useState(null)
  const [error, setError]                 = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const [pending, setPending]             = useState(null)
  const [successMsg, setSuccessMsg]       = useState('')
  const modalRef = useRef(null)

  // —————— Efecto: obtener detalle de VM al cambiar vmId ——————
  useEffect(() => {
    if (!vmId) {
      setDetail(null)
      return
    }
    setLoading(true)
    setError('')
    api.get(`/vms/${vmId}`)
      .then(res => setDetail(res.data))
      .catch(() => setError('No se pudo cargar el detalle.'))
      .finally(() => setLoading(false))
  }, [vmId])

  // —————— Efecto: enfocar modal y cerrar con Esc ——————
  useEffect(() => {
    if (!vmId) return
    modalRef.current?.focus()
    const onKey = e => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [vmId, onClose])

  if (!vmId) return null

  // —————— Helper: crea botones de acción con icono y spinner ——————
  const actionButton = (text, themeKey, apiPath, Icon) => {
    const isLoading = actionLoading === apiPath
    const theme = ACTION_THEMES[themeKey] ?? ACTION_THEMES.start
    return (
      <Motion.button
        key={apiPath}
        type="button"
        whileHover={isLoading ? {} : { scale: 1.05 }}
        whileTap={isLoading ? {} : { scale: 0.95 }}
        disabled={isLoading}
        className={[
          'flex items-center justify-center py-2 rounded font-medium text-white shadow transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          theme.base,
          isLoading ? 'opacity-70 cursor-not-allowed' : '',
        ].join(' ')}
        onClick={() => {
          if (isLoading) return
          setPending({ apiPath, text })
          setSuccessMsg('')
        }}
      >
        {isLoading
          ? (/* Spinner SVG durante la acción */ 
            <svg className="inline-block w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          )
          : (
            /* Icono + texto del botón */
            <>
              {Icon && <Icon className="mr-2" />}
              {text}
            </>
          )
        }
      </Motion.button>
    )
  }

  // —————— Variantes de animación para backdrop y modal ——————
  const backdropVariants = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.2 } },
  }
  const modalVariants = {
    hidden:  { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
    exit:    { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
  }

  // —————— Contenido del modal ——————
  const content = (
    <AnimatePresence>
      {vmId && (
        // Backdrop con animación
        <Motion.div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
          onClick={onClose}
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* Ventana modal animada */}
          <Motion.div
            ref={modalRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vm-detail-title"
            className="bg-white text-gray-800 p-6 rounded-2xl shadow-xl max-w-md w-full relative focus:outline-none"
            onClick={e => e.stopPropagation()}
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Botón de cerrar */}
            <button
              onClick={onClose}
              aria-label="Cerrar detalle de VM"
              className="absolute top-4 right-4 text-gray-600 hover:text-gray-900 transition text-xl"
            >
              &times;
            </button>

            {/* Título del modal */}
            <h3 id="vm-detail-title" className="text-2xl font-semibold mb-4">
              Detalle VM {vmId}
            </h3>

            {/* Mensaje de éxito tras acción */}
            {successMsg && (
              <div className="bg-green-100 text-green-800 p-3 rounded mb-4">
                {successMsg}
              </div>
            )}

            {/* Skeleton mientras carga */}
            {loading && (
              <div className="space-y-3 mb-6 px-4">
                {SKELETON_WIDTHS.map((widthClass, index) => (
                  <div key={index} className={`h-4 bg-gray-200 rounded animate-pulse ${widthClass}`} />
                ))}
              </div>
            )}
            {/* Mensaje de error de carga */}
            {error && <p className="text-center text-red-600 mb-4">{error}</p>}

            {/* Confirmación interna de acción */}
            {pending && (
              <div className="bg-gray-100 border border-gray-300 rounded p-4 mb-4">
                <p className="text-gray-800">
                  ¿Seguro que deseas <strong>{pending.text.toLowerCase()}</strong> la VM “{detail?.name}”?
                </p>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                    onClick={async () => {
                      setActionLoading(pending.apiPath)
                      let ok = false
                      try {
                        await api.post(`/vms/${vmId}/power/${pending.apiPath}`)
                        ok = true
                      } catch {
                        alert(`Error al intentar ${pending.text.toLowerCase()}.`)
                      } finally {
                        setActionLoading(null)
                        setPending(null)
                      }
                      if (ok) {
                        setSuccessMsg(`VM “${detail.name}” ${pending.text.toLowerCase()} exitósamente.`)
                        onAction(pending.apiPath)
                      }
                    }}
                  >
                    Sí
                  </button>
                  <button
                    className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
                    onClick={() => setPending(null)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {/* Lista de detalles una vez cargados */}
            {!loading && detail && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6 px-4">
                {[
                  ['Nombre', detail.name],
                  ['Estado', detail.power_state==='POWERED_ON' ? 'Encendida' : 'Apagada'],
                  ['CPU', detail.cpu_count],
                  ['RAM', `${detail.memory_size_MiB} MiB`],
                  ['OS', detail.guest_os],
                  ['IPs', (detail.ip_addresses && detail.ip_addresses.length) ? detail.ip_addresses.join(', ') : '�'],
                  ['Discos', renderDisksWithBars(detail.disks)],
                  ['NICs', (detail.nics && detail.nics.length) ? detail.nics.join(', ') : '�'],
                  ['Host', detail.host || '�'],
                  ['Cluster', detail.cluster || '�'],
                  ['VLAN(s)', (detail.networks && detail.networks.length) ? detail.networks.join(', ') : '�'],
                ].map(([dt,dd])=>(
                  <div key={dt} className="col-span-1 flex">
                    <dt className="font-medium text-gray-700 w-1/2">{dt}:</dt>
                    <dd className="text-gray-800 flex-1">{dd}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* Botones de acción de power */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {actionButton('Encender', 'start', 'start', IoPowerSharp)}
              {actionButton('Apagar',   'stop',  'stop',  IoPowerOutline)}
              {actionButton('Reset',    'reset', 'reset', IoRefreshSharp)}
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  )

  // —————— Renderiza el modal en el body usando un portal ——————
  return createPortal(content, document.body)
}






