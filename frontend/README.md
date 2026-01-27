# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Microsoft Login (MSAL)

1) En Entra Admin Center, en la App Registration:
   - Authentication -> Platform: Single-page application
   - Redirect URI: `http://localhost:5173/`
2) Configura variables en `frontend/.env` (sin secretos):
   - `VITE_AZURE_CLIENT_ID` (mismo valor que backend `AZURE_CLIENT_ID`)
   - `VITE_AZURE_TENANT_ID` (mismo valor que backend `AZURE_TENANT_ID`)
   - (Opcional) `VITE_ENTRA_AUTHORITY`
3) Ejecuta frontend y backend y prueba “Continuar con Microsoft”.
