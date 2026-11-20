export const config = {
  // D38: Keycloak se publica en el mismo origen que la app (local, túnel o nube); VITE_OIDC_AUTHORITY solo para `vite dev`
  authority: import.meta.env.VITE_OIDC_AUTHORITY || `${window.location.origin}/realms/sses`,
  apiUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  demo: import.meta.env.VITE_DEMO === '1',
}
