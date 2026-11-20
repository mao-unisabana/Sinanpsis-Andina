import { test, expect } from '@playwright/test'
import { login, sql } from './helpers'

test('F9 · Analista del MEN: tablero por región, clasificación, detalle semanal y exportación (RQ_013)', async ({ page }) => {
  await login(page, 'analista.men@sinapsis.co')
  await expect(page.getByTestId('encabezado-rol')).toHaveText('Analista del MEN')
  const menu = page.getByRole('navigation', { name: 'Menú principal' })
  await expect(menu.getByRole('link').filter({ hasNotText: 'Inicio' })).toHaveCount(1) // 'Inicio' es común a todos los roles
  await menu.getByRole('link', { name: 'Analítica' }).click()
  await page.getByRole('link', { name: 'Desempeño de tutores' }).click()
  await expect(page.getByRole('heading', { name: 'Desempeño de tutores' })).toBeVisible()

  await expect(page.getByTestId('kpi-tutores')).not.toHaveText('0')
  await expect(page.getByTestId('grafico-regiones').locator('canvas')).toBeVisible()
  const total = await page.getByTestId('fila-tutor').count()
  expect(total).toBeGreaterThan(10)

  // filtro por región → solo tutores de esa región
  await page.getByTestId('filtros').getByLabel('Región').selectOption({ label: 'Pacífico' })
  await page.getByRole('button', { name: 'Aplicar' }).click()
  await expect.poll(async () => (await page.getByTestId('fila-tutor').locator('td:nth-child(3)').allTextContents()).every((t) => t === 'Pacífico')).toBe(true)
  expect(await page.getByTestId('fila-tutor').count()).toBeLessThan(total)

  // detalle semana a semana
  await page.getByTestId('fila-tutor').first().getByRole('button').click()
  await expect(page.getByTestId('detalle-tutor').getByTestId('fila-semana')).toHaveCount(4)

  // exportar
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar' }).click()])
  expect(d.suggestedFilename()).toMatch(/^desempeno-tutores-\d{4}-\d{2}\.xlsx$/)
  expect(sql(`select count(*) from auditoria.bitacora where rol='ANALISTA_MEN' and accion='EXPORTAR_TABLERO'`)).not.toBe('0')
})
