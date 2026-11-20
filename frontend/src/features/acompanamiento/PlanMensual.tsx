import { useState } from 'react'
import Pestanas from './Pestanas'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiRaw, ApiError } from '../../app/api'
import { useOnline } from '../../app/useOnline'
import { AreaTexto, Aviso, Boton, Campo, Insignia, Tarjeta } from '../../ui/kit'
import { mesActual, rangoSemana, type DocentesPorEstrategia, type Hito, type PlanMes } from './tipos'
import { leerPlan, guardarPlan } from '../../offline/planLocal'
import { esErrorDeRed } from '../../offline/red'
import { useOutbox } from '../../offline/outbox'
import { sincronizarAhora } from '../../offline/sync'
import type { RegistroOutbox } from '../../offline/db'

export function EstadoHito({ h }: { h: Hito }) {
  if (h.estado === 'CONFIRMADO') return <Insignia tono="verde" data-testid="estado-hito">Confirmada por el docente</Insignia>
  if (h.estado === 'OBSERVADO') return <Insignia tono="rojo" data-testid="estado-hito">Observada</Insignia>
  return h.estado === 'PROGRAMADA'
    ? <Insignia tono="azul" data-testid="estado-hito">Programada</Insignia>
    : <Insignia tono="verde" data-testid="estado-hito">Registrada</Insignia>
}

export default function PlanMensual() {
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') ?? mesActual()
  const plan = useQuery({
    queryKey: ['plan', mes],
    queryFn: async (): Promise<PlanMes & { desdeLocal?: number }> => {
      try { const r = await apiRaw<PlanMes>(`/tutores/me/plan?mes=${mes}`); await guardarPlan(mes, r.data, r.etag); return r.data }
      catch (e) { if (esErrorDeRed(e)) { const l = await leerPlan(mes); if (l) return { ...l.data, desdeLocal: l.guardadoEn } } throw e }
    },
  })
  const outbox = useOutbox(mes)
  const locales = new Map<string, RegistroOutbox>(outbox.filter((r) => r.estado !== 'Rechazado').map((r) => [r.hitoId, r]))
  const base = plan.data
  // Cumplimiento optimista: las semanas 'Pendiente' (guardadas en este dispositivo) cuentan como registradas
  const nPend = base ? base.planes.flatMap((pl) => pl.hitos).filter((h) => h.estado === 'PROGRAMADA' && locales.get(h.id)?.estado === 'Pendiente').length : 0
  const p = base && nPend > 0
    ? { ...base, cumplimiento: { ...base.cumplimiento, registradas: base.cumplimiento.registradas + nPend, porcentaje: Math.round((10000 * (base.cumplimiento.registradas + nPend)) / Math.max(1, base.cumplimiento.programadas)) / 100 } }
    : base
  const st = useLocation().state as { registrada?: number; pendiente?: number } | null
  const registrada = st?.registrada
  return (
    <div className="max-w-3xl mx-auto md:mx-0">
      <Pestanas />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-andino-900">Plan mensual</h1><p className="text-sm text-slate-500">Acompañamientos del mes y su seguimiento semanal</p></div>
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Mes</span>
          <input type="month" value={mes} onChange={(e) => e.target.value && setSp({ mes: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 bg-white" data-testid="selector-mes" />
        </label>
      </div>

      {registrada && <Aviso tono="ok" className="mt-4" data-testid="aviso-registrada">Semana {registrada} registrada.</Aviso>}
      {st?.pendiente && <Aviso tono="alerta" className="mt-4" data-testid="aviso-pendiente">Semana {st.pendiente} guardada en este dispositivo: Pendiente. Se sincronizará cuando vuelva la señal.</Aviso>}
      {base?.desdeLocal && <Aviso tono="info" className="mt-4" data-testid="aviso-datos-locales">Mostrando el plan guardado en este dispositivo ({new Date(base.desdeLocal).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}).</Aviso>}
      {plan.isLoading && <p className="mt-6 text-slate-500">Cargando plan…</p>}
      {plan.isError && <Aviso tono="error" className="mt-4">{esErrorDeRed(plan.error) ? 'Sin conexión y sin datos guardados para este mes. Abre este mes con señal una vez para tenerlo disponible.' : 'No pudimos cargar el plan.'} <button className="underline" onClick={() => void plan.refetch()}>Reintentar</button></Aviso>}

      {p && (
        <>
          <Tarjeta className="mt-4 p-4" >
            <div className="flex items-baseline justify-between"><h2 className="font-semibold text-slate-800">Cumplimiento del mes</h2>
              <span className="text-2xl font-bold text-andino-900" data-testid="cumplimiento-porcentaje">{Math.round(p.cumplimiento.porcentaje)} %</span></div>
            <div className="mt-2 h-3 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(p.cumplimiento.porcentaje)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-cumple transition-all" style={{ width: `${p.cumplimiento.porcentaje}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-slate-500" data-testid="cumplimiento-detalle">{p.cumplimiento.registradas} de {p.cumplimiento.programadas} semanas registradas</p>
          </Tarjeta>

          <h2 className="mt-6 mb-2 font-semibold text-slate-800">Calendario del mes</h2>
          {p.planes.length === 0 && <Tarjeta className="p-6 text-center text-slate-500">Aún no hay acompañamientos programados para este mes. Usa el formulario de abajo.</Tarjeta>}
          <div className="grid gap-3" data-testid="calendario">
            {p.planes.map((pl) => (
              <Tarjeta key={pl.id} className="p-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0"><p className="font-medium">{pl.estrategia.nombre}</p>
                    <p className="text-xs text-slate-500">{pl.modalidad === 'GRUPAL' ? 'Grupal' : 'Individual'} · {pl.docentes.map((d) => d.nombres).join(', ')}</p></div>
                </div>
                <p className="mt-1 text-xs text-slate-500">Temas: {pl.temas}</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {pl.hitos.map((h) => {
                    const loc = locales.get(h.id)
                    const pendiente = h.estado === 'PROGRAMADA' && loc?.estado === 'Pendiente'
                    const enConflicto = loc?.estado === 'En conflicto'
                    const estadoVista = pendiente ? 'PENDIENTE' : h.estado
                    return (
                      <li key={h.id} data-testid="hito" data-estado={estadoVista} className={`rounded-lg border p-3 ${pendiente ? 'border-dashed border-green-400 bg-cumple-50/60' : h.estado === 'PROGRAMADA' && !enConflicto ? 'border-slate-200 bg-slate-50' : enConflicto ? 'border-red-300 bg-red-50' : 'border-green-200 bg-cumple-50'}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap"><span className="font-medium text-sm">Semana {h.numeroSemana}</span>
                          <span className="flex gap-1 flex-wrap justify-end">
                            {pendiente ? <Insignia tono="verde" data-testid="estado-hito">🕒 Registrada (pendiente)</Insignia> : <EstadoHito h={h} />}
                            {loc && <EstadoRegistro r={loc} />}
                          </span></div>
                        <p className="text-xs text-slate-500">{rangoSemana(h.fechaInicio, h.fechaFin)} · {h.semanaIso}</p>
                        {enConflicto
                          ? <Link to={`conflicto/${loc!.idempotencyKey}`} className="mt-2 inline-block"><Boton className="!py-1.5" variante="peligro">Resolver conflicto</Boton></Link>
                          : h.estado === 'PROGRAMADA' && !pendiente
                            ? <Link to={`registrar/${h.id}`} className="mt-2 inline-block"><Boton className="!py-1.5">Registrar seguimiento</Boton></Link>
                            : pendiente ? <p className="mt-2 text-xs text-green-800">Guardada en este dispositivo; se enviará al volver la señal.</p>
                            : <p className="mt-2 text-xs text-green-800">{h.seguimiento?.asistencia.filter((a) => a.asistio).length ?? 0} de {pl.docentes.length} asistieron</p>}
                      </li>
                    )
                  })}
                </ul>
              </Tarjeta>
            ))}
          </div>
          <PanelSincronizacion registros={outbox} />
          <Programar mes={mes} semanas={p.semanas} />
        </>
      )}
    </div>
  )
}

function Programar({ mes, semanas }: { mes: string; semanas: PlanMes['semanas'] }) {
  const qc = useQueryClient(); const online = useOnline()
  const grupos = useQuery({ queryKey: ['docentes'], queryFn: () => api<DocentesPorEstrategia>('/tutores/me/docentes') })
  const [estrategia, setEstrategia] = useState<string | null>(null)
  const [docs, setDocs] = useState<string[]>([])
  const [modalidad, setModalidad] = useState<'INDIVIDUAL' | 'GRUPAL'>('GRUPAL')
  const [temas, setTemas] = useState('')
  const [sem, setSem] = useState<number[]>([])
  const [msg, setMsg] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  const alternar = <T,>(l: T[], v: T) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v])
  const marcar = (est: string, id: string) => {
    if (estrategia !== est) { setEstrategia(est); setDocs([id]) } else setDocs((d) => alternar(d, id))
  }
  const motivo = docs.length === 0 ? 'Marca al menos un docente.' : modalidad === 'GRUPAL' && docs.length < 2 ? 'Un plan grupal necesita al menos 2 docentes.'
    : modalidad === 'GRUPAL' && docs.length > 30 ? 'Máximo 30 docentes.' : !temas.trim() ? 'Escribe los temas.' : sem.length === 0 ? 'Selecciona al menos una semana.' : !online ? 'Necesitas conexión para programar.' : null

  async function programar() {
    setMsg(null); setEnviando(true)
    try {
      await apiRaw('/acompanamientos', { method: 'POST', body: { mes, modalidad, estrategiaId: estrategia, docenteIds: docs, temas, semanas: sem } })
      await qc.invalidateQueries({ queryKey: ['plan'] })
      setMsg({ tono: 'ok', texto: 'Plan programado. Ya aparece en el calendario del mes.' }); setDocs([]); setTemas(''); setSem([])
    } catch (x) {
      setMsg({ tono: 'error', texto: x instanceof ApiError ? x.message : 'No hay conexión con el servidor.' })
    } finally { setEnviando(false) }
  }

  return (
    <>
      <h2 className="mt-8 mb-2 font-semibold text-slate-800">Programar acompañamientos</h2>
      <Tarjeta className="p-4 grid gap-5" data-testid="form-programar">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700 mb-2">Tus tutores docentes, por estrategia</legend>
          {grupos.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
          {grupos.data?.estrategias.length === 0 && <p className="text-sm text-slate-500">Aún no tienes docentes asignados.</p>}
          <div className="grid gap-3">
            {grupos.data?.estrategias.map((g) => (
              <div key={g.estrategia.id} className={`rounded-lg border p-3 ${estrategia === g.estrategia.id ? 'border-andino-700 bg-andino-50/50' : 'border-slate-200'}`}>
                <p className="font-medium text-sm">{g.estrategia.nombre}</p><p className="text-xs text-slate-500 mb-2">{g.estrategia.entidad}</p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {g.docentes.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm py-1.5 min-h-10">
                      <input type="checkbox" className="w-5 h-5" checked={estrategia === g.estrategia.id && docs.includes(d.id)} onChange={() => marcar(g.estrategia.id, d.id)} /> {d.nombres}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700 mb-2">Modalidad</legend>
          <div className="flex gap-4">
            {(['INDIVIDUAL', 'GRUPAL'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm min-h-10"><input type="radio" name="modalidad" className="w-5 h-5" checked={modalidad === m} onChange={() => setModalidad(m)} /> {m === 'GRUPAL' ? 'Grupal' : 'Individual'}</label>
            ))}
          </div>
        </fieldset>

        <Campo etiqueta="Temas" htmlFor="temas" ayuda="Máximo 2.000 caracteres."><AreaTexto id="temas" rows={3} maxLength={2000} value={temas} onChange={(e) => setTemas(e.target.value)} /></Campo>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700 mb-2">Semanas del mes</legend>
          <div className="flex gap-2 flex-wrap">
            {semanas.map((s) => (
              <label key={s.numero} className={`rounded-lg border px-3 py-2 text-sm cursor-pointer min-h-11 ${sem.includes(s.numero) ? 'border-andino-700 bg-andino-50 font-medium' : 'border-slate-300'}`}>
                <input type="checkbox" className="sr-only" checked={sem.includes(s.numero)} onChange={() => setSem((l) => alternar(l, s.numero))} aria-label={`Semana ${s.numero}`} />
                Semana {s.numero}<span className="block text-xs text-slate-500">{rangoSemana(s.fechaInicio, s.fechaFin)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {msg && <Aviso tono={msg.tono}>{msg.texto}</Aviso>}
        <div className="flex items-center gap-3 justify-end flex-wrap">
          {motivo && <span className="text-xs text-slate-500">{motivo}</span>}
          <Boton onClick={() => void programar()} disabled={!!motivo || enviando}>Programar</Boton>
        </div>
      </Tarjeta>
    </>
  )
}

export function EstadoRegistro({ r }: { r: RegistroOutbox }) {
  const tono = { Pendiente: 'ambar', Sincronizado: 'verde', 'En conflicto': 'rojo', Rechazado: 'rojo' } as const
  return <Insignia tono={tono[r.estado]} data-testid="estado-registro">{r.estado}</Insignia>
}

function PanelSincronizacion({ registros }: { registros: RegistroOutbox[] }) {
  const online = useOnline(); const [ocupado, setOcupado] = useState(false)
  const visibles = [...registros].sort((a, b) => b.creadoEn - a.creadoEn).slice(0, 10)
  if (visibles.length === 0) return null
  const hayPend = registros.some((r) => r.estado === 'Pendiente')
  return (
    <>
      <div className="mt-6 mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Registros de este dispositivo</h2>
        <Boton variante="secundario" className="!py-1.5" disabled={ocupado || !online || !hayPend} onClick={() => { setOcupado(true); void sincronizarAhora().finally(() => setOcupado(false)) }}>Sincronizar ahora</Boton>
      </div>
      <Tarjeta><ul className="divide-y divide-slate-100" data-testid="registros-locales">
        {visibles.map((r) => (
          <li key={r.idempotencyKey} className="px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap text-sm" data-testid="registro-local">
            <span>Semana {r.numeroSemana} · {r.estrategia}{r.nFotos > 0 && <small className="text-slate-400"> · {r.nFotos} foto(s)</small>}</span>
            <span className="flex items-center gap-2">{r.motivo && <small className="text-red-700">{r.motivo}</small>}<EstadoRegistro r={r} /></span>
          </li>
        ))}
      </ul></Tarjeta>
    </>
  )
}
