import { PublicClientApplication } from "@azure/msal-browser";

const clientId =
  import.meta.env.VITE_AZURE_CLIENT_ID || import.meta.env.VITE_ENTRA_CLIENT_ID;
const tenantId =
  import.meta.env.VITE_AZURE_TENANT_ID || import.meta.env.VITE_ENTRA_TENANT_ID;
const authority =
  import.meta.env.VITE_ENTRA_AUTHORITY ||
  (tenantId
    ? `https://login.microsoftonline.com/${tenantId}`
    : "https://login.microsoftonline.com/common");

const cacheLocationEnv = import.meta.env.VITE_MSAL_CACHE;
const cacheLocation = cacheLocationEnv === "localStorage" ? "localStorage" : "sessionStorage";

export const msalConfig = {
  auth: {
    clientId,
    authority,
    redirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation,
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "email"],
};

export const msalInstance = new PublicClientApplication(msalConfig);
