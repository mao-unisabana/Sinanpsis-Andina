import { test, expect } from '@playwright/test'
import { login, programarPlanDemo, tokenDe, API, sql, mesActual, registrarSemana, resetDemo } from './helpers'

test.beforeAll(() => { resetDemo() })

test('F7 · sin conexión: abre desde caché, guarda Pendiente, sincroniza, no duplica y resuelve conflictos en ambos sentidos', async ({ page, context, request }) => {
  test.setTimeout(240_000)
  const cuerpos: string[] = []
  await page.route('**/api/v1/sincronizacion/seguimientos', async (route) => { cuerpos.push(route.request().postData() ?? ''); await route.continue() })

  await login(page, 'tutor.lider@sinapsis.co')
  await programarPlanDemo(page, [1, 2, 3])
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 })
  await expect.poll(async () => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'sses-local'))).toBe(true)
  const h = { Authorization: `Bearer ${await tokenDe(page)}` }

  // ---- sin señal: la app abre desde caché y avisa ----
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('aviso-sin-conexion')).toHaveText('Sin conexión: tus registros se guardarán en este dispositivo')
  await expect(page.getByTestId('indicador-conexion')).toContainText('Sin conexión')
  await expect(page.getByTestId('hito')).toHaveCount(3)

  // ---- registros offline: quedan 'Pendiente' ----
  await registrarSemana(page, 1, 'Semana 1 registrada SIN señal', true)
  await expect(page.getByTestId('aviso-pendiente')).toBeVisible()
  await expect(page.getByTestId('hito').nth(0)).toHaveAttribute('data-estado', 'PENDIENTE')
  await expect(page.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Pendiente')
  await registrarSemana(page, 2, 'Semana 2 del DISPOSITIVO')
  await registrarSemana(page, 3, 'Semana 3 del DISPOSITIVO')
  await expect(page.getByTestId('indicador-pendientes')).toHaveText('3 pendientes')
  await expect(page.getByTestId('cumplimiento-porcentaje')).toHaveText('100 %') // optimista local
  expect(sql(`select count(*) from (select s.* from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}') t`)).toBe('0')

  // ---- mientras tanto, otro dispositivo registra las semanas 2 y 3 en línea ----
  const plan = await (await request.get(`${API}/tutores/me/plan?mes=${mesActual()}`, { headers: h })).json()
  const hitos = plan.planes[0].hitos as { id: string; version: number }[]
  const docs = plan.planes[0].docentes as { id: string }[]
  for (const [i, txt] of [[1, 'Semana 2 del SERVIDOR'], [2, 'Semana 3 del SERVIDOR']] as const) {
    const r = await request.put(`${API}/hitos/${hitos[i].id}/seguimiento`, { headers: { ...h, 'If-Match': `W/"${hitos[i].version}"` },
      data: { asistencia: docs.map((d) => ({ docenteId: d.id, asistio: false })), actividades: txt, avances: 'otro dispositivo', evidenciaIds: [] } })
    expect(r.status()).toBe(200)
  }

  // ---- vuelve la señal: sincroniza solo ----
  await context.setOffline(false)
  await expect(page.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Sincronizado', { timeout: 30_000 })
  await expect(page.getByTestId('hito').nth(0)).toHaveAttribute('data-estado', 'REGISTRADA')
  await expect(page.getByTestId('hito').nth(1).getByTestId('estado-registro')).toHaveText('En conflicto')
  await expect(page.getByTestId('hito').nth(2).getByTestId('estado-registro')).toHaveText('En conflicto')
  await expect(page.getByTestId('indicador-pendientes')).toHaveText('0 pendientes')
  await expect(page.getByTestId('indicador-conflictos')).toHaveText('2 en conflicto')
  expect(sql(`select count(*) from (select s.* from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}') t where origen='SIN_CONEXION'`)).toBe('1') // una sola fila, sin duplicar
  expect(sql(`select count(*) from (select s.* from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}') t`)).toBe('3')

  // ---- reenvío del mismo lote → DUPLICADO sin filas nuevas ----
  expect(cuerpos.length).toBeGreaterThan(0)
  const rep = await request.post(`${API}/sincronizacion/seguimientos`, { headers: { ...h, 'Content-Type': 'application/json' }, data: cuerpos[0] })
  const estados = (await rep.json()).resultados.map((r: { estado: string }) => r.estado)
  expect(estados).toEqual(['DUPLICADO', 'DUPLICADO', 'DUPLICADO'])
  expect(sql(`select count(*) from (select s.* from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}') t`)).toBe('3')

  // ---- conflicto semana 2: conservar el mío ----
  await page.getByTestId('hito').nth(1).getByRole('link', { name: 'Resolver conflicto' }).click()
  await expect(page.getByTestId('version-local')).toContainText('Semana 2 del DISPOSITIVO')
  await expect(page.getByTestId('version-servidor')).toContainText('Semana 2 del SERVIDOR')
  await expect(page.getByTestId('version-servidor')).toContainText('Andrés Tutor Líder')
  await page.getByRole('button', { name: 'Conservar el mío' }).click()
  await expect(page.getByRole('heading', { name: 'Plan mensual' })).toBeVisible()
  await expect(page.getByTestId('hito').nth(1).getByTestId('estado-registro')).toHaveText('Sincronizado', { timeout: 30_000 })

  // ---- conflicto semana 3: conservar el del servidor ----
  await page.getByTestId('hito').nth(2).getByRole('link', { name: 'Resolver conflicto' }).click()
  await page.getByRole('button', { name: 'Conservar el del servidor' }).click()
  await expect(page.getByRole('heading', { name: 'Plan mensual' })).toBeVisible()
  await expect(page.getByTestId('hito').nth(2).getByTestId('estado-registro')).toHaveText('Sincronizado')
  await expect(page.getByTestId('cumplimiento-porcentaje')).toHaveText('100 %')
  await expect(page.getByTestId('indicador-conflictos')).toHaveCount(0)

  // ---- estado final en el servidor y bitácora ----
  expect(sql(`select count(*) from (select s.* from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}') t`)).toBe('3')
  expect(sql(`select actividades from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id where h.numero_semana=2 and h.plan_id=(select max(id) from acompanamiento.plan)`)).toBe('Semana 2 del DISPOSITIVO')
  expect(sql(`select actividades from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id where h.numero_semana=3 and h.plan_id=(select max(id) from acompanamiento.plan)`)).toBe('Semana 3 del SERVIDOR')
  expect(Number(sql(`select count(*) from auditoria.bitacora where accion='CONFLICTO_RESUELTO'`))).toBeGreaterThanOrEqual(2)
  expect(sql('select ok from auditoria.verificar_cadena()')).toBe('t')
})
