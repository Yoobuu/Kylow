# 🖥️ Inventario VMware

Aplicación web para extraer, clasificar y mostrar información de máquinas virtuales (VMs) desde un entorno VMware vCenter, usando APIs REST y SOAP.

* 🔒 **Autenticación** asegurada con JWT.
* ⚙️ **Backend**: FastAPI.
* 🎨 **Frontend**: React + Vite + Tailwind.
* 🧪 **Entornos** soportados: Producción, Test, Sandbox y Desarrollo.

---

## 🚀 Estructura del proyecto

```
INVENTARIO_VMWARE/
├── backend/
│   ├── app/              # Código principal FastAPI
│   ├── scripts/          # Automatización (init_user)
│   ├── requirements.txt  # Dependencias Python
│   └── .env.example      # Variables de entorno de ejemplo
├── frontend/
│   ├── src/              # Código React/Vite
│   ├── package.json      # Dependencias Node
│   └── .env.example      # Variables de entorno de ejemplo
└── README.md             # Documentación del proyecto
```

---

## ⚙️ Requisitos

* **Python** 3.10+
* **Node.js** 18+
* Acceso a un servidor VMware vCenter
* **Herramientas**: pip, uvicorn, virtualenv/npm

---

## 📦 Instalación

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

#### Variables de entorno

Copia `.env.example` a `.env` y rellena:

```env
VCENTER_HOST=https://<IP_o_dominio_vcenter>
VCENTER_USER=usuario@vsphere.local
VCENTER_PASS=contraseña_segura
SECRET_KEY=clave_super_secreta
INITIAL_ADMIN_PASS=admin123      # Contraseña inicial del script init_user
FRONTEND_ORIGIN=http://localhost:5173  # Origen permitido para CORS
```

#### Inicializar base de datos y usuario admin

```bash
python scripts/init_user.py
```

#### Ejecutar servidor

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

### 2. Frontend

```bash
cd frontend
npm install
```

#### Variables de entorno

Copia `.env.example` a `.env` y ajusta:

```env
VITE_API_URL=http://<IP_de_backend>:8000/api
```

#### Ejecutar aplicación React

```bash
npm run dev
```

---

## 🔐 Acceso y autenticación

1. Abre `/login` en el navegador.
2. Credenciales:

   * **Usuario**: `api-inventory@vsphere.local` (o el que definas en init\_user)
   * **Contraseña**: el valor de `INITIAL_ADMIN_PASS` en `.env`
3. Se generará un JWT válido para consumir las rutas protegidas (`/api/*`).

---

## 🛠️ Funcionalidades principales

* Listado de VMs con filtros y búsqueda global.
* Vista detallada de cada VM con estadísticas, discos, NICs e IPs.
* Acciones remotas: encender, apagar o reiniciar VM.
* Distinción visual y grouping por entorno, estado, host, cluster, VLAN o SO.
* Exportación a CSV con un clic.

---

## 🚫 Ignorado por Git

* `.env`, `.env.example` (plantilla)
* `app.db`, certificados y claves privadas
* `node_modules/`, `__pycache__/`, `.vscode/`, `dist/`, etc.

---

## 📄 Licencia & Autor

**Paulo Cantos** – Universidad San Francisco de Quito (USFQ) – 2025
*Pasante #8, Departamento de TI USFQ*
