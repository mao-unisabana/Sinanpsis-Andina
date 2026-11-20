import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from './auth'
import { userManager } from './auth-manager'

export default function Callback() {
  // Dentro del iframe de renovación silenciosa solo se completa la renovación (no se registra un LOGIN nuevo)
  if (window.parent !== window) return <RenovacionSilenciosa />
  return <CallbackPrincipal />
}

function RenovacionSilenciosa() {
  useEffect(() => { void userManager.signinSilentCallback().catch(() => undefined) }, [])
  return null
}

function CallbackPrincipal() {
  const { completarLogin } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const hecho = useRef(false)
  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    completarLogin().then(() => nav('/inicio', { replace: true })).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo completar el ingreso.'))
  }, [completarLogin, nav])
  return (
    <main className="min-h-screen grid place-items-center p-6">
      {error ? (
        <div role="alert" className="max-w-md rounded-lg bg-red-50 border border-red-200 p-6 text-red-800">
          <p className="font-semibold">No pudimos completar tu ingreso</p>
          <p className="text-sm mt-1">{error}</p>
          <a className="mt-4 inline-block underline" href="/">Volver al inicio</a>
        </div>
      ) : <p className="text-slate-600">Verificando tu ingreso…</p>}
    </main>
  )
}
