import { test, expect } from '@playwright/test'
import { login, programarPlanDemo, registrarSemana, sql, resetDemo, mesActual } from './helpers'

test.beforeAll(() => { resetDemo() })

test('F9 · Tutor Docente confirma en línea, observa sin señal, sincroniza una sola vez y el Tutor Líder ve los estados', async ({ browser }) => {
  test.setTimeout(240_000)
  const tl = await (await browser.newContext({ locale: 'es-CO' })).newPage()
  await login(tl, 'tutor.lider@sinapsis.co')
  await programarPlanDemo(tl, [1, 2, 3])
  await registrarSemana(tl, 1, 'Taller de planeación semana 1')
  await registrarSemana(tl, 2, 'Taller de evaluación semana 2')

  const ctx = await browser.newContext({ locale: 'es-CO', serviceWorkers: 'allow' })
  const dc = await ctx.newPage()
  await login(dc, 'tutor.docente@sinapsis.co')
  await expect(dc.getByTestId('encabezado-rol')).toHaveText('Tutor Docente')
  await expect(dc.getByRole('navigation').getByRole('link', { name: 'Acompañamientos' })).toHaveCount(0)
  await dc.getByRole('navigation').getByRole('link', { name: 'Mi acompañamiento' }).click()
  await expect(dc.getByRole('heading', { name: 'Mi acompañamiento' })).toBeVisible()
  await expect(dc.getByTestId('semana-1').getByTestId('estado-semana')).toHaveText('Registrada')
  await expect(dc.getByTestId('semana-3').getByTestId('estado-semana')).toHaveText('Programada')
  await expect(dc.getByTestId('semana-3').getByRole('link')).toHaveCount(0) // sin registro del TL no hay nada que confirmar

  // ---- en línea: confirmar ----
  await dc.getByTestId('semana-1').getByRole('link', { name: 'Abrir' }).click()
  await expect(dc.getByTestId('actividades')).toHaveText('Taller de planeación semana 1')
  await dc.getByLabel('Confirmar acompañamiento').check()
  await dc.getByRole('button', { name: 'Enviar' }).click()
  await expect(dc.getByTestId('aviso-enviada')).toBeVisible()
  await expect(dc.getByTestId('semana-1').getByTestId('estado-semana')).toHaveText('Confirmada por el docente')

  // ---- sin señal: observación queda Pendiente y luego se sincroniza ----
  await ctx.setOffline(true)
  await expect(dc.getByTestId('aviso-sin-conexion')).toHaveText('Sin conexión: tus registros se guardarán en este dispositivo')
  await dc.getByTestId('semana-2').getByRole('link', { name: 'Abrir' }).click()
  await dc.getByRole('button', { name: 'Enviar' }).click()
  await expect(dc.getByText('Marca "Confirmar acompañamiento" o escribe una observación.')).toBeVisible()
  await dc.getByLabel('Observación').fill('El encuentro fue virtual, no presencial')
  await dc.getByRole('button', { name: 'Enviar' }).click()
  await expect(dc.getByTestId('aviso-pendiente')).toBeVisible()
  await expect(dc.getByTestId('semana-2').getByTestId('estado-semana')).toHaveText('Pendiente')
  await expect(dc.getByTestId('indicador-pendientes')).toHaveText('1 pendientes')
  expect(sql(`select count(*) from acompanamiento.confirmacion_docente c join acompanamiento.hito_semanal h on h.id=c.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.mes='${mesActual()}' and c.docente_id=1`)).toBe('1')
  await ctx.setOffline(false)
  await expect(dc.getByTestId('semana-2').getByTestId('estado-semana')).toHaveText('Observada', { timeout: 30_000 })
  await expect(dc.getByTestId('indicador-pendientes')).toHaveText('0 pendientes')
  expect(sql(`select count(*) from acompanamiento.confirmacion_docente c join acompanamiento.hito_semanal h on h.id=c.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.mes='${mesActual()}' and c.docente_id=1`)).toBe('2')
  expect(sql(`select count(*) from acompanamiento.confirmacion_docente c join acompanamiento.hito_semanal h on h.id=c.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.mes='${mesActual()}' and c.origen='SIN_CONEXION' and c.docente_id=1`)).toBe('1')
  expect(sql(`select string_agg(estado, ',' order by numero_semana) from acompanamiento.hito_semanal h join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and p.mes='${mesActual()}'`)).toBe('CONFIRMADO,OBSERVADO,PROGRAMADA')

  // ---- el Tutor Líder ve la versión de quien recibe ----
  await tl.reload()
  await expect(tl.getByTestId('hito').nth(0).getByTestId('estado-hito')).toHaveText('Confirmada por el docente')
  await expect(tl.getByTestId('hito').nth(1).getByTestId('estado-hito')).toHaveText('Observada')
  await expect(tl.getByTestId('cumplimiento-porcentaje')).toHaveText('67 %')
})
