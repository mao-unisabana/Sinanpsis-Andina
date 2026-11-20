import { test, expect } from '@playwright/test'
import { login, resetDemo, sql } from './helpers'

test.beforeAll(() => { resetDemo() })

// D40 / D41: "Mi desempeño" del Tutor Líder con el historial sembrado (scripts/seed-historial-tutor.sql) e informe mensual verificable
test('D40 · Mi desempeño muestra indicadores, gráfico y detalle; el informe del mes se descarga y se verifica', async ({ page }) => {
  test.setTimeout(180_000)
  await login(page, 'tutor.lider@sinapsis.co')
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Acompañamientos' }).click()
  await page.getByRole('navigation', { name: 'Secciones de acompañamientos' }).getByRole('link', { name: 'Mi desempeño' }).click()
  await expect(page.getByRole('heading', { name: 'Mi desempeño' })).toBeVisible()

  await expect(page.getByTestId('kpis-desempeno')).toBeVisible()
  await expect(page.getByTestId('kpi-sin-conexion')).not.toHaveText('0') // el historial tiene registros capturados sin señal
  await expect(page.getByTestId('grafico-desempeno')).toBeVisible()
  await expect(page.getByTestId('tabla-desempeno').locator('tbody tr')).toHaveCount(6)

  // Informe del mes anterior (con historial): PDF descargado + código verificable públicamente
  const opciones = await page.getByLabel('Mes del informe').locator('option').allTextContents()
  expect(opciones.length).toBeGreaterThan(0)
  const descarga = page.waitForEvent('download')
  await page.getByTestId('descargar-informe').click()
  expect((await descarga).suggestedFilename()).toMatch(/^informe-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\.pdf$/)
  const codigo = (await page.getByTestId('informe-generado').locator('a').textContent())!.trim()
  expect(sql(`select count(*) from reportes.informe_mensual where codigo_verificacion='${codigo}'`)).toBe('1')
  expect(sql(`select count(*) from auditoria.bitacora where accion='GENERAR_INFORME_MENSUAL'`)).not.toBe('0')

  await page.goto(`/verificar/${codigo}`)
  await page.getByRole('button', { name: 'Verificar' }).click()
  await expect(page.getByTestId('verificacion-ok')).toContainText('Informe mensual del acompañamiento')
})

test('D40 · otro rol no puede consultar el desempeño de un tutor (403)', async ({ page, request }) => {
  await login(page, 'gestor.demo@sinapsis.co')
  const token = await page.evaluate(() => {
    const k = Object.keys(sessionStorage).find((x) => x.startsWith('oidc.user:'))
    return k ? (JSON.parse(sessionStorage.getItem(k)!) as { access_token: string }).access_token : ''
  })
  const r = await request.get('/api/v1/tutores/me/desempeno', { headers: { Authorization: `Bearer ${token}` } })
  expect(r.status()).toBe(403)
})
