import React from 'react'
import ReactDOM from 'react-dom/client'
import { MsalProvider } from "@azure/msal-react";
import './index.css'  // Estilos globales de la aplicación

// —————— Importación del componente principal ——————
import App from './App'
import { TutorialProvider } from './context/TutorialContext'
import { msalInstance } from "./auth/msalConfig";

// —————— Punto de entrada y montaje en el DOM ——————
msalInstance.initialize().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Renderiza el componente App en modo estricto */}
    <MsalProvider instance={msalInstance}>
      <TutorialProvider>
        <App />
      </TutorialProvider>
    </MsalProvider>
  </React.StrictMode>
)
})
