import { Route, Routes } from 'react-router'
import PlanMensual from './PlanMensual'
import Registrar from './Registrar'
import Conflicto from './Conflicto'
import Desempeno from './Desempeno'

export default function AcompanamientoRoutes() {
  return (
    <Routes>
      <Route index element={<PlanMensual />} />
      <Route path="registrar/:hitoId" element={<Registrar />} />
      <Route path="conflicto/:clave" element={<Conflicto />} />
      <Route path="desempeno" element={<Desempeno />} />
    </Routes>
  )
}
