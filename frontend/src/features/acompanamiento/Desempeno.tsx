import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiRaw, ApiError } from '../../app/api'
import { getAccessToken } from '../../app/auth-manager'
import { config } from '../../app/config'
import { db } from '../../offline/db'
import { esErrorDeRed } from '../../offline/red'
import { Aviso, Boton, Insignia, Tarjeta, Vacio } from '../../ui/kit'
import Pestanas from './Pestanas'
import { etiquetaMes, mesActual, rangoSemana, type MesDesempeno } from './tipos'

const Grafico = lazy(() => import('./GraficoDesempeno')) // ECharts solo se descarga al abrir esta pestaña (RQ_027)

type Datos = {
  mesActual: string
  indicadores: { cumplimientoMes: number; registradasMes: number; programadasMes: number; sinConexionPeriodo: number; registrosPeriodo: number; confirmacionPeriodo: number; regularidadPeriodo: number; porConfirmar: number; docentesAtendidosMes: number }
  meses: (MesDesempeno & { confirmadas: number; observadas: number; docentesAtendidos: number; regularidad: number })[]
  porRegistrar: { hitoId: string; mes: string; numeroSemana: number; fechaInicio: string; fechaFin: string; estrategia: string }[]
  totalPorRegistrar: number
}
type Informe = { id: string; codigo: string; huella: string; mes: string; descarga: string }

const pct = (n: number) => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`

/** D40: "Mi desempeño" del Tutor Líder (RQ_010–RQ_013). Funciona sin señal con la última copia guardada. */
export default function Desempeno() {
  const q = useQuery({
    queryKey: ['desempeno'],
    queryFn: async (): Promise<Datos & { guardadoEn?: number }> => {
      try { const r = await apiRaw<Datos>('/tutores/me/desempeno?meses=6'); await db.desempeno.put({ clave: 'yo', data: r.data, guardadoEn: Date.now() }); return r.data }
      catch (e) { if (esErrorDeRed(e)) { const l = await db.desempeno.get('yo'); if (l) return { ...(l.data as Datos), guardadoEn: l.guardadoEn } } throw e }
    },
  })
  const d = q.data
  return (
    <div className="max-w-5xl">
      <Pestanas />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-andino-900">Mi desempeño</h1>
          <p className="text-sm text-slate-500">Tu cumplimiento mes a mes, el trabajo que hiciste sin señal y lo que confirmaron tus docentes</p></div>
        {d && <InformeMensual mesInicial={d.mesActual} meses={d.meses.filter((m) => m.programadas > 0).map((m) => m.mes)} />}
      </div>
      {d?.guardadoEn && <Aviso tono="info" className="mt-4">Sin conexión: mostrando lo guardado en este dispositivo el {new Date(d.guardadoEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}.</Aviso>}
      {q.isLoading && <p className="mt-6 text-slate-500">Cargando…</p>}
      {q.isError && <Aviso tono="error" className="mt-4">{esErrorDeRed(q.error) ? 'Sin conexión y sin datos guardados. Abre esta pestaña una vez con señal para tenerla disponible.' : 'No pudimos cargar tu desempeño.'} <button className="underline" onClick={() => void q.refetch()}>Reintentar</button></Aviso>}

      {d && <>
        <div className="mt-5 grid gap-4 grid-cols-2 lg:grid-cols-4" data-testid="kpis-desempeno">
          <Kpi titulo={`Cumplimiento de ${etiquetaMes(d.mesActual)}`} valor={d.indicadores.programadasMes === 0 ? 'Sin plan' : pct(d.indicadores.cumplimientoMes)}
            detalle={d.indicadores.programadasMes === 0 ? 'Programa el mes en "Plan mensual"' : `${d.indicadores.registradasMes} de ${d.indicadores.programadasMes} semanas registradas`} testid="kpi-cumplimiento" tono="azul" />
          <Kpi titulo="Registrado sin señal" valor={String(d.indicadores.sinConexionPeriodo)} detalle={`de ${d.indicadores.registrosPeriodo} registros en 6 meses, sincronizados sin pérdida`} testid="kpi-sin-conexion" tono="ambar" />
          <Kpi titulo="Confirmado por docentes" valor={pct(d.indicadores.confirmacionPeriodo)} detalle={`${d.indicadores.porConfirmar} semanas esperan confirmación`} testid="kpi-confirmacion" tono="verde" />
          <Kpi titulo="Registro a tiempo" valor={pct(d.indicadores.regularidadPeriodo)} detalle="hasta 2 días después de la semana" testid="kpi-regularidad" tono="gris" />
        </div>

        <Tarjeta className="mt-5 p-4">
          <h2 className="font-semibold text-andino-900">Últimos 6 meses</h2>
          <p className="text-xs text-slate-500 mb-2">Semanas registradas (en línea y sin conexión) y cumplimiento del mes</p>
          <Suspense fallback={<div className="h-72 grid place-items-center text-sm text-slate-500">Cargando gráfico…</div>}><Grafico datos={d.meses} /></Suspense>
        </Tarjeta>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <Tarjeta className="p-4" data-testid="por-registrar">
            <h2 className="font-semibold text-andino-900">Semanas por registrar</h2>
            <p className="text-xs text-slate-500 mb-2">Las más recientes de las {d.totalPorRegistrar} semanas que ya pasaron sin seguimiento</p>
            {d.porRegistrar.length === 0 ? <Vacio titulo="Estás al día" detalle="No tienes semanas vencidas sin registrar." /> : (
              <ul className="divide-y divide-slate-100">
                {d.porRegistrar.map((h) => (
                  <li key={h.hitoId} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{h.estrategia}</p><p className="text-xs text-slate-500">Semana {h.numeroSemana} · {rangoSemana(h.fechaInicio, h.fechaFin)}</p></div>
                    <Link to={`/acompanamientos/registrar/${h.hitoId}`}><Boton variante="secundario" className="!py-1.5">Registrar seguimiento</Boton></Link>
                  </li>
                ))}
              </ul>)}
          </Tarjeta>
          <Tarjeta className="p-4 overflow-x-auto">
            <h2 className="font-semibold text-andino-900 mb-2">Detalle por mes</h2>
            <table className="w-full text-sm" data-testid="tabla-desempeno">
              <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="py-2">Mes</th><th>Programadas</th><th>Registradas</th><th>Sin señal</th><th>Confirmadas</th><th>Cumplimiento</th></tr></thead>
              <tbody>{[...d.meses].reverse().map((m) => (
                <tr key={m.mes} className="border-b border-slate-100"><td className="py-2 font-medium">{etiquetaMes(m.mes)}</td><td>{m.programadas}</td><td>{m.registradas}</td><td>{m.sinConexion}</td>
                  <td>{m.confirmadas}{m.observadas > 0 && <span className="text-xs text-red-700"> · {m.observadas} obs.</span>}</td>
                  <td><Insignia tono={m.programadas === 0 ? 'gris' : m.cumplimiento >= 80 ? 'verde' : m.cumplimiento >= 50 ? 'ambar' : 'rojo'}>{m.programadas === 0 ? '—' : pct(m.cumplimiento)}</Insignia></td></tr>))}</tbody>
            </table>
          </Tarjeta>
        </div>
      </>}
    </div>
  )
}

function Kpi({ titulo, valor, detalle, testid, tono }: { titulo: string; valor: string; detalle: string; testid: string; tono: 'azul' | 'ambar' | 'verde' | 'gris' }) {
  const barra = { azul: 'bg-andino-700', ambar: 'bg-amber-500', verde: 'bg-cumple', gris: 'bg-slate-400' }[tono]
  return (
    <Tarjeta className="p-4 relative overflow-hidden">
      <span className={`absolute inset-y-0 left-0 w-1 ${barra}`} />
      <p className="text-xs font-medium text-slate-500">{titulo}</p>
      <p className="mt-1 text-3xl font-bold text-andino-900" data-testid={testid}>{valor}</p>
      <p className="mt-1 text-xs text-slate-500">{detalle}</p>
    </Tarjeta>
  )
}

async function descargarPdf(url: string, nombre: string) {
  const t = await getAccessToken()
  const r = await fetch(`${config.apiUrl}${url.replace(/^\/api\/v1/, '')}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
  if (!r.ok) throw new ApiError(r.status, 'DESCARGAR', 'No pudimos descargar el informe.')
  const href = URL.createObjectURL(await r.blob()); const a = document.createElement('a')
  a.href = href; a.download = nombre; a.click(); URL.revokeObjectURL(href)
}

/** D41: informe mensual en PDF con código de verificación y huella SHA-256 (mismo mecanismo que los reportes de ley, RQ_014). */
function InformeMensual({ mesInicial, meses }: { mesInicial: string; meses: string[] }) {
  const opciones = meses.length > 0 ? meses : [mesInicial || mesActual()]
  const [mes, setMes] = useState(opciones.includes(mesInicial) ? mesInicial : opciones[opciones.length - 1])
  const generar = useMutation({
    mutationFn: async () => {
      const inf = await api<Informe>('/tutores/me/informe-mensual', { method: 'POST', body: { mes }, timeoutMs: 40000 })
      await descargarPdf(inf.descarga, `informe-${inf.codigo}.pdf`)
      return inf
    },
  })
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select aria-label="Mes del informe" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          {[...opciones].reverse().map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
        </select>
        <Boton onClick={() => generar.mutate()} disabled={generar.isPending} data-testid="descargar-informe">{generar.isPending ? 'Generando…' : 'Descargar reporte del mes'}</Boton>
      </div>
      {generar.data && <p className="text-xs text-slate-600" data-testid="informe-generado">Código de verificación <a className="font-mono font-semibold text-andino-700 underline" href={`/verificar/${generar.data.codigo}`} target="_blank" rel="noreferrer">{generar.data.codigo}</a></p>}
      {generar.isError && <p className="text-xs text-red-700">{esErrorDeRed(generar.error) ? 'Necesitas conexión para generar el informe.' : generar.error instanceof ApiError ? generar.error.message : 'No pudimos generar el informe.'}</p>}
    </div>
  )
}
