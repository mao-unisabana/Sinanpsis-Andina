import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { userManager } from './auth-manager'
import { api, ApiError } from './api'

export type ItemMenu = { clave: string; etiqueta: string; ruta: string; habilitado: boolean; nota?: string | null }
export type Perfil = { nombre: string; rol: string; rolEtiqueta: string; ultimoIngreso: string | null; menu: ItemMenu[] }

type Estado = 'cargando' | 'anonimo' | 'autenticado'
type Ctx = {
  estado: Estado
  perfil: Perfil | null
  sinSesionLocal: boolean // perfil restaurado sin red/sin token (modo sin conexión)
  perfilLocal: Perfil | null // perfil guardado en este dispositivo (permite entrar sin conexión, D39)
  continuarSinConexion: () => void
  ingresar: () => void
  salir: () => void
  completarLogin: () => Promise<void>
  aviso: string | null
}
const AuthCtx = createContext<Ctx | null>(null)
const PERFIL_KEY = 'sses.perfil'

function leerPerfilLocal(): Perfil | null {
  try { const s = localStorage.getItem(PERFIL_KEY); return s ? (JSON.parse(s) as Perfil) : null } catch { return null }
}
/** D39: ¿responde el servidor? `navigator.onLine` no basta (wifi sin internet, túnel caído). */
async function servidorAlcanzable(): Promise<boolean> {
  if (!navigator.onLine) return false
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000)
  try { return (await fetch('/health/live', { cache: 'no-store', signal: ctrl.signal })).ok } catch { return false } finally { clearTimeout(t) }
}

function guardarPerfilLocal(p: Perfil | null) {
  try { if (p) localStorage.setItem(PERFIL_KEY, JSON.stringify(p)); else localStorage.removeItem(PERFIL_KEY) } catch { /* sin almacenamiento */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('cargando')
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [sinSesionLocal, setSinSesionLocal] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const u = await userManager.getUser()
      if (u && !u.expired) {
        try {
          const p = await api<Perfil>('/me')
          if (!vivo) return
          guardarPerfilLocal(p); setPerfil(p); setEstado('autenticado'); return
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) { setAviso(e.message) }
          else if (!(e instanceof ApiError)) {
            // sin red: se usa el perfil guardado
            const loc = leerPerfilLocal()
            if (loc && vivo) { setPerfil(loc); setSinSesionLocal(true); setEstado('autenticado'); return }
          }
        }
      } else {
        // D39: sin token (la PWA se cerró y se reabrió). Con perfil guardado en este dispositivo:
        // sin servidor → modo sin conexión; con servidor → se intenta el SSO silencioso (sesión de Keycloak vigente).
        const loc = leerPerfilLocal()
        if (loc) {
          if (!(await servidorAlcanzable())) { if (vivo) { setPerfil(loc); setSinSesionLocal(true); setEstado('autenticado') } return }
          try {
            const r = await userManager.signinSilent()
            if (r) { const p = await api<Perfil>('/me'); if (!vivo) return; guardarPerfilLocal(p); setPerfil(p); setEstado('autenticado'); return }
          } catch { /* sin sesión de Keycloak: se muestra el inicio para ingresar */ }
        }
      }
      if (vivo) setEstado('anonimo')
    })()
    return () => { vivo = false }
  }, [])

  // Al volver la red con un perfil local sin token: renovar sesión (SSO) sin borrar nada local
  useEffect(() => {
    if (!sinSesionLocal) return
    const h = async () => {
      const u = await userManager.getUser()
      if (u && !u.expired) { setSinSesionLocal(false); return }
      try {
        const r = await userManager.signinSilent()
        if (r) { setSinSesionLocal(false); void import('../offline/sync').then((m) => m.sincronizarAhora()) } // envía lo capturado sin señal
      } catch { /* se pedirá ingresar de nuevo desde el aviso; la cola local se conserva */ }
    }
    window.addEventListener('online', h)
    // Si se entró sin conexión sin que el navegador lo notara (wifi sin internet, túnel caído), se reintenta cada 20 s
    const t = setInterval(() => { void servidorAlcanzable().then((ok) => { if (ok) void h() }) }, 20_000)
    return () => { window.removeEventListener('online', h); clearInterval(t) }
  }, [sinSesionLocal])

  const ingresar = useCallback(() => {
    setAviso(null)
    userManager.signinRedirect().catch(() => setAviso(navigator.onLine
      ? 'No pudimos conectar con el servidor de ingreso. Revisa tu conexión e inténtalo de nuevo.'
      : 'Sin conexión: necesitas señal para ingresar.'))
  }, [])
  const continuarSinConexion = useCallback(() => {
    const loc = leerPerfilLocal(); if (!loc) return
    setPerfil(loc); setSinSesionLocal(true); setEstado('autenticado')
  }, [])
  const salir = useCallback(() => {
    void (async () => {
      const { contarPendientes } = await import('../offline/outbox')
      const n = await contarPendientes().catch(() => 0)
      if (n > 0 && !window.confirm(`Tienes ${n} registro(s) pendientes de sincronizar en este dispositivo. Si sales ahora se perderán y ya no podrás abrir el SSES sin conexión en este dispositivo hasta volver a ingresar con señal. ¿Salir de todos modos?`)) return
      guardarPerfilLocal(null)
      await import('../offline/crypto').then((m) => m.olvidarClave()).catch(() => undefined)
      void userManager.signoutRedirect()
    })()
  }, [])
  const completarLogin = useCallback(async () => {
    await userManager.signinRedirectCallback()
    const p = await api<Perfil>('/sesion/inicio', { method: 'POST' }) // registra LOGIN (RQ_005)
    guardarPerfilLocal(p); setPerfil(p); setSinSesionLocal(false); setEstado('autenticado')
  }, [])

  const perfilLocal = estado === 'anonimo' ? leerPerfilLocal() : null
  const v = useMemo(() => ({ estado, perfil, sinSesionLocal, perfilLocal, continuarSinConexion, ingresar, salir, completarLogin, aviso }),
    [estado, perfil, sinSesionLocal, perfilLocal, continuarSinConexion, ingresar, salir, completarLogin, aviso])
  return <AuthCtx.Provider value={v}>{children}</AuthCtx.Provider>
}

// El hook comparte archivo con el proveedor a propósito: separarlos tocaría a todos los importadores.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth fuera de AuthProvider')
  return c
}
