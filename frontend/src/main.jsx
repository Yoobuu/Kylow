import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'  // Estilos globales de la aplicación

// —————— Importación del componente principal ——————
import App from './App'

// —————— Punto de entrada y montaje en el DOM ——————
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Renderiza el componente App en modo estricto */}
    <App />
  </React.StrictMode>
)
