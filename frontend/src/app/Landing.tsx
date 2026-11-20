import { useAuth } from './auth'
import { useOnline } from './useOnline'
import { IconoBitacora, IconoCandado, IconoFlecha, IconoSinSenal } from '../ui/iconos'

const PILARES = [
  { Icono: IconoCandado, titulo: 'Acceso seguro', texto: 'Segundo factor y datos de los estudiantes cifrados.' },
  { Icono: IconoSinSenal, titulo: 'Funciona sin señal', texto: 'Lo registrado en campo se sincroniza al volver la conexión.' },
  { Icono: IconoBitacora, titulo: 'Trazabilidad total', texto: 'Cada acción queda en una bitácora que no se puede alterar.' },
]

export default function Landing() {
  const { ingresar, aviso, perfilLocal, continuarSinConexion } = useAuth()
  const online = useOnline()
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-andino-950 via-andino-900 to-andino-700 text-white">
      <svg aria-hidden="true" viewBox="0 0 800 400" className="absolute -right-32 -bottom-24 w-[900px] opacity-[0.06]">
        <g stroke="#3ddc97" strokeWidth="5" fill="none" strokeLinecap="round"><path d="M20 380 180 120 330 300 500 60 660 260 790 140" /><circle cx="180" cy="120" r="14" /><circle cx="330" cy="300" r="14" /><circle cx="500" cy="60" r="14" /><circle cx="660" cy="260" r="14" /></g>
      </svg>
      <div className="relative mx-auto max-w-5xl px-6 py-10 md:py-16 min-h-screen flex flex-col">
        <header className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="w-10 h-10 rounded-xl" />
          <span className="leading-tight"><span className="block font-bold">Sinapsis Andina S.A.S.</span><span className="block text-xs text-andino-200/80">Tecnología que llega a cada rincón del país</span></span>
        </header>

        <section className="flex-1 grid md:grid-cols-[1.2fr_1fr] gap-10 items-center py-12">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-cumple-400" />Piloto · Ministerio de Educación Nacional
            </p>
            <h1 className="mt-5 text-5xl md:text-6xl font-bold tracking-tight">SSES</h1>
            <p className="mt-3 text-lg md:text-xl text-andino-50/90 max-w-lg">Sistema de Seguimiento de Actividades Extracurriculares</p>
            <p className="mt-4 text-sm text-andino-100/80 max-w-lg">Estrategias estudiantiles y acompañamiento pedagógico de los tutores, en un solo sistema y desde cualquier región del país.</p>
            {aviso && <p role="alert" className="mt-6 rounded-lg bg-red-100 text-red-800 px-4 py-2 text-sm max-w-md">{aviso}</p>}
            {!online && (
              <div role="status" data-testid="landing-sin-conexion" className="mt-6 max-w-md rounded-xl bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-3">
                <IconoSinSenal width={20} height={20} className="shrink-0 mt-0.5" />
                <span>{perfilLocal
                  ? 'Sin conexión. Puedes seguir trabajando con lo guardado en este dispositivo; tus registros se enviarán cuando vuelva la señal.'
                  : 'Sin conexión. Necesitas señal para el primer ingreso en este dispositivo; después podrás trabajar sin conexión.'}</span>
              </div>
            )}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {!online && perfilLocal ? (
                <button onClick={continuarSinConexion} data-testid="continuar-sin-conexion"
                  className="group inline-flex items-center gap-2 rounded-xl bg-cumple px-8 py-3.5 text-lg font-semibold shadow-lg shadow-black/20 hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 transition">
                  Continuar sin conexión como {perfilLocal.nombre.split(' ')[0]} <IconoFlecha className="transition-transform group-hover:translate-x-1" />
                </button>
              ) : (
                <button onClick={ingresar} disabled={!online}
                  className="group inline-flex items-center gap-2 rounded-xl bg-cumple px-8 py-3.5 text-lg font-semibold shadow-lg shadow-black/20 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 transition">
                  Ingresar <IconoFlecha className="transition-transform group-hover:translate-x-1" />
                </button>
              )}
            </div>
            <a href="/verificar" className="mt-4 block text-sm text-andino-50 underline">Verificar un reporte de ley</a>
            <p className="mt-3 text-xs text-andino-100/70">Acceso con segundo factor. Cada consulta o cambio queda registrado a tu nombre.</p>
          </div>

          <ul className="grid gap-3">
            {PILARES.map(({ Icono, titulo, texto }) => (
              <li key={titulo} className="flex gap-4 rounded-2xl bg-white/[0.07] ring-1 ring-white/15 backdrop-blur p-5">
                <span className="grid place-items-center shrink-0 w-11 h-11 rounded-xl bg-cumple/20 text-cumple-400"><Icono width={22} height={22} /></span>
                <span><span className="block font-semibold">{titulo}</span><span className="block text-sm text-andino-100/80 mt-0.5">{texto}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-xs text-andino-200/60">Datos sintéticos de demostración · Propuesta de Sinapsis Andina S.A.S.</footer>
      </div>
    </main>
  )
}
