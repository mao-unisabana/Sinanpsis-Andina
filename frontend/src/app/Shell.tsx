import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from './auth'
import { useOnline } from './useOnline'
import { useEffect, useRef, useState } from 'react'
import { usePendientes, useEnConflicto } from '../offline/outbox'
import { iniciarSincronizacion } from '../offline/sync'
import { precargarPlanes } from '../offline/planLocal'
import BotonAyuda from '../features/ayuda/BotonAyuda'
import { IconoAlerta, IconoBitacora, IconoChevron, IconoInicio, IconoMenu, IconoNube, IconoSalir, IconoSinSenal } from '../ui/iconos'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'primer ingreso')
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

type Item = { clave: string; etiqueta: string; ruta: string; habilitado: boolean; nota?: string | null }

export default function Shell() {
  const { perfil, salir, sinSesionLocal, ingresar } = useAuth()
  const online = useOnline()
  const pendientes = usePendientes()
  const enConflicto = useEnConflicto()
  const esTutor = perfil?.rol === 'TUTOR_LIDER'
  const esDocente = perfil?.rol === 'TUTOR_DOCENTE'
  useEffect(() => { if (esTutor || esDocente) { iniciarSincronizacion(); if (esTutor && navigator.onLine) void precargarPlanes() } }, [esTutor, esDocente])
  if (!perfil) return null
  const menu: Item[] = [{ clave: 'inicio', etiqueta: 'Inicio', ruta: '/inicio', habilitado: true }, ...perfil.menu]
  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex md:w-64 shrink-0 flex-col bg-gradient-to-b from-andino-950 to-andino-900 text-white sticky top-0 h-screen">
        <Link to="/inicio" className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          <img src="/icon.svg" alt="" className="w-9 h-9 rounded-lg" />
          <span className="leading-tight"><span className="block font-bold tracking-wide">SSES</span><span className="block text-[11px] text-andino-200/80">Piloto · Ministerio de Educación</span></span>
        </Link>
        <p className="px-5 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wider text-andino-200/60">Menú</p>
        <nav aria-label="Menú principal" className="flex flex-col gap-1 px-3">
          {menu.map((m) => <ItemMenu key={m.clave} m={m} />)}
        </nav>
        <div className="mt-auto m-3 rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-andino-100/80">
          <p className="font-semibold text-white/90">Sinapsis Andina S.A.S.</p>
          <p className="mt-0.5">Tecnología que llega a cada rincón del país</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 min-h-16 bg-white/85 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-2 lg:py-0 flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
          <Link to="/inicio" className="md:hidden flex items-center gap-2 mr-auto">
            <img src="/icon.svg" alt="" className="w-8 h-8 rounded-lg" /><span className="font-bold text-andino-900">SSES</span>
          </Link>
          <div className="hidden md:block mr-auto" />

          <span data-testid="indicador-conexion" title={online ? 'Conectado al servidor' : 'Trabajando sin conexión'}
            className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ring-1 ring-inset ${online ? 'bg-cumple-50 text-cumple ring-cumple/20' : 'bg-slate-100 text-slate-700 ring-slate-300'}`}>
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-cumple animate-pulse' : 'bg-slate-500'}`} /><span className={online ? 'hidden sm:inline' : ''}>{online ? 'En línea' : 'Sin conexión'}</span>
          </span>
          {(esTutor || esDocente) && (
            <span data-testid="indicador-pendientes" title="Registros guardados en este dispositivo que faltan por sincronizar"
              className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ring-1 ring-inset ${pendientes > 0 ? 'bg-amber-50 text-amber-800 ring-amber-300' : 'bg-white text-slate-500 ring-slate-200'}`}>
              <IconoNube width={14} height={14} />{pendientes}<span className="hidden sm:inline"> pendientes</span>
            </span>
          )}
          {enConflicto > 0 && (
            <span data-testid="indicador-conflictos" className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 bg-red-50 text-red-800 ring-1 ring-inset ring-red-300">
              <IconoAlerta width={14} height={14} />{enConflicto}<span className="hidden sm:inline"> en conflicto</span>
            </span>
          )}
          <BotonAyuda />
          <span className="hidden lg:block w-px h-8 bg-slate-200" />
          {/* HU_002: nombre, rol y último ingreso siempre visibles (en el celular, como segunda línea del encabezado) */}
          <div className="order-last basis-full lg:order-none lg:basis-auto min-w-0 text-xs text-slate-500 leading-tight lg:text-right">
            <span className="font-semibold text-slate-900 text-sm lg:block" data-testid="encabezado-nombre">{perfil.nombre}</span>
            <span className="lg:hidden"> · </span>
            <span data-testid="encabezado-rol">{perfil.rolEtiqueta}</span> · Último ingreso: <span data-testid="encabezado-ultimo">{fmt(perfil.ultimoIngreso)}</span>
          </div>
          <MenuUsuario nombre={perfil.nombre} rol={perfil.rolEtiqueta} ultimo={fmt(perfil.ultimoIngreso)} salir={salir} />
        </header>

        {!online && (
          <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 md:px-6 py-2.5 flex items-center gap-2">
            <IconoSinSenal width={18} height={18} className="shrink-0" />
            <span data-testid="aviso-sin-conexion">Sin conexión: tus registros se guardarán en este dispositivo</span>
          </div>
        )}
        {sinSesionLocal && online && (
          <div role="alert" className="bg-andino-50 border-b border-andino-200 text-andino-900 text-sm px-4 md:px-6 py-2.5 flex flex-wrap gap-3 items-center">
            Tu sesión necesita renovarse para sincronizar. Tus registros locales se conservan.
            <button onClick={ingresar} className="rounded-md bg-andino-900 text-white px-3 py-1 text-xs font-semibold hover:bg-andino-800">Ingresar de nuevo</button>
          </div>
        )}

        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8"><Outlet /></main>

        <nav aria-label="Menú móvil" className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-andino-950 text-white flex justify-around px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] border-t border-white/10">
          {menu.map((m) => <ItemMenu key={m.clave} m={m} movil />)}
        </nav>
      </div>
    </div>
  )
}

function ItemMenu({ m, movil }: { m: Item; movil?: boolean }) {
  const Icono = IconoMenu[m.clave] ?? IconoInicio
  if (movil) {
    const base = 'flex-1 flex flex-col items-center gap-0.5 text-[11px] px-1 py-1.5 rounded-lg'
    if (!m.habilitado) return <span aria-disabled="true" title={m.nota ?? ''} className={`${base} opacity-40`}><Icono />{m.etiqueta}</span>
    return <NavLink to={m.ruta} className={({ isActive }) => `${base} ${isActive ? 'bg-white/15 font-semibold text-white' : 'text-andino-100/80'}`}><Icono />{m.etiqueta}</NavLink>
  }
  const base = 'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors'
  if (!m.habilitado)
    return (
      <span aria-disabled="true" title={m.nota ?? ''} className={`${base} text-andino-100/40 cursor-not-allowed`}>
        <Icono />{m.etiqueta}
        {m.nota && <small className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-andino-100/60">{m.nota}</small>}
      </span>
    )
  return (
    <NavLink to={m.ruta} end={m.clave === 'inicio'}
      className={({ isActive }) => `${base} ${isActive ? 'bg-white/12 text-white font-semibold before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-cumple-400' : 'text-andino-100/80 hover:bg-white/8 hover:text-white'}`}>
      <Icono />{m.etiqueta}
    </NavLink>
  )
}

/** Avatar que despliega 'Bitácora de actividad' y 'Salir' (el nombre, rol y último ingreso van siempre visibles en el encabezado). */
function MenuUsuario({ nombre, rol, ultimo, salir }: { nombre: string; rol: string; ultimo: string; salir: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setAbierto((v) => !v)} aria-haspopup="menu" aria-expanded={abierto} aria-label="Menú de usuario"
        className="flex items-center gap-2.5 rounded-xl pl-1 pr-2 py-1 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-andino-600/50">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-andino-700 to-andino-950 text-white text-sm font-semibold shadow-sm">{iniciales(nombre)}</span>
        <IconoChevron width={16} height={16} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden z-30">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-semibold text-slate-900">{nombre}</p>
            <p className="text-xs text-slate-500">{rol}</p>
            <p className="mt-1 text-xs text-slate-500">Último ingreso: {ultimo}</p>
          </div>
          <div className="p-1.5">
            <Link role="menuitem" to="/auditoria" onClick={() => setAbierto(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-andino-50 hover:text-andino-900">
              <IconoBitacora width={18} height={18} />Bitácora de actividad
            </Link>
            <button role="menuitem" onClick={salir} className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">
              <IconoSalir width={18} height={18} />Salir
            </button>
          </div>
          <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">Cada consulta o cambio queda registrado a tu nombre.</p>
        </div>
      )}
    </div>
  )
}
