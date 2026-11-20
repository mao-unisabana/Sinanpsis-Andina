import { NavLink } from 'react-router'

/** D40: 'Acompañamientos' del Tutor Líder agrupa el plan del mes y su desempeño (HU_002 fija los ítems del menú). */
export default function Pestanas() {
  const base = 'px-4 py-2 text-sm font-semibold rounded-lg transition-colors'
  const cls = ({ isActive }: { isActive: boolean }) => `${base} ${isActive ? 'bg-white text-andino-900 shadow-sm' : 'text-slate-600 hover:text-andino-900'}`
  return (
    <nav aria-label="Secciones de acompañamientos" className="mb-5 inline-flex gap-1 rounded-xl bg-slate-200/70 p-1">
      <NavLink to="/acompanamientos" end className={cls}>Plan mensual</NavLink>
      <NavLink to="/acompanamientos/desempeno" className={cls}>Mi desempeño</NavLink>
    </nav>
  )
}
