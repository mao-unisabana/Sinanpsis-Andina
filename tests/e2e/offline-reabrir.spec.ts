import { test, expect } from '@playwright/test'
import { login, programarPlanDemo, registrarSemana, resetDemo, sql } from './helpers'

test.beforeAll(() => { resetDemo() })

// D39: es el recorrido de la demo en el celular: ingresar con señal, cerrar la app, abrirla en modo avión,
// registrar y sincronizar al volver la señal. Cada pestaña nueva tiene su propio sessionStorage (sin token),
// igual que una PWA que se cierra y se vuelve a abrir.
test('D39 · cerrar la app, reabrirla sin señal, registrar y sincronizar al volver', async ({ context, page }) => {
  test.setTimeout(240_000)
  await login(page, 'tutor.lider@sinapsis.co')
  await programarPlanDemo(page, [1, 2, 3])
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 })
  await page.close()

  // ---- modo avión: se abre la app de nuevo ----
  await context.setOffline(true)
  const app = await context.newPage()
  await app.goto('/')
  await expect(app.getByTestId('encabezado-nombre')).toHaveText('Andrés Tutor Líder', { timeout: 20_000 })
  await expect(app.getByTestId('aviso-sin-conexion')).toHaveText('Sin conexión: tus registros se guardarán en este dispositivo')
  await app.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Acompañamientos' }).click()
  await expect(app.getByTestId('hito')).toHaveCount(3)

  await registrarSemana(app, 1, 'Registrada tras reabrir la app SIN señal')
  await expect(app.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Pendiente')
  await expect(app.getByTestId('indicador-pendientes')).toHaveText('1 pendientes')

  // ---- vuelve la señal: renovación silenciosa de la sesión y envío automático ----
  await context.setOffline(false)
  await expect(app.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Sincronizado', { timeout: 45_000 })
  await expect(app.getByTestId('indicador-pendientes')).toHaveText('0 pendientes')
  expect(sql(`select count(*) from acompanamiento.seguimiento_semanal s join acompanamiento.hito_semanal h on h.id=s.hito_id join acompanamiento.plan p on p.id=h.plan_id where p.tutor_id=1 and s.origen='SIN_CONEXION' and s.actividades like 'Registrada tras reabrir%'`)).toBe('1')
})

test('D39 · sin señal y sin ingreso previo en el dispositivo, el inicio lo explica', async ({ context, page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.waitForFunction(() => !!navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), undefined, { timeout: 30_000 })
  await page.reload() // el service worker toma control y deja la app en caché
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('landing-sin-conexion')).toContainText('Necesitas señal para el primer ingreso')
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeDisabled()
})
