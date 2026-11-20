export type Docente = { id: string; nombres: string }
export type DocentesPorEstrategia = { estrategias: { estrategia: { id: string; nombre: string; entidad: string }; docentes: Docente[] }[] }
export type Seguimiento = {
  actividades: string; avances: string; origen: 'EN_LINEA' | 'SIN_CONEXION'; registradoPor: string | null; registradoEn: string | null
  asistencia: { docenteId: string; asistio: boolean }[]; evidencias: { id: string; tipoMime: string; bytes: number }[]
}
export type Hito = {
  id: string; numeroSemana: number; semanaIso: string; fechaInicio: string; fechaFin: string
  estado: 'PROGRAMADA' | 'REGISTRADA' | 'CONFIRMADO' | 'OBSERVADO'; version: number; seguimiento: Seguimiento | null
}
export type PlanItem = {
  id: string; estrategia: { id: string; nombre: string }; modalidad: 'INDIVIDUAL' | 'GRUPAL'; temas: string; docentes: Docente[]; hitos: Hito[]
}
export type PlanMes = {
  mes: string; semanas: { numero: number; semanaIso: string; fechaInicio: string; fechaFin: string }[]; planes: PlanItem[]
  cumplimiento: { registradas: number; programadas: number; porcentaje: number }
}
export type HitoDetalle = {
  id: string; mes: string; numeroSemana: number; semanaIso: string; fechaInicio: string; fechaFin: string; estado: Hito['estado']; version: number
  temas: string; estrategia: { id: string; nombre: string }; docentes: Docente[]
}

export const mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const f = (s: string) => new Date(s + 'T00:00:00')
export const rangoSemana = (i: string, e: string) => {
  const a = f(i), b = f(e)
  const mesA = a.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), mesB = b.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${mesB}` : `${a.getDate()} ${mesA} – ${b.getDate()} ${mesB}`
}
export const esRegistrada = (e: Hito['estado']) => e !== 'PROGRAMADA'

// D40: serie de "Mi desempeño" (aquí y no en el gráfico, para no arrastrar ECharts al paquete de la pantalla)
export type MesDesempeno = { mes: string; programadas: number; registradas: number; enLinea: number; sinConexion: number; cumplimiento: number }
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`
