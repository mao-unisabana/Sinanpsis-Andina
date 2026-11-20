import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { login, sql } from './helpers'

test('F9 · Ente de Control: genera el reporte, descarga el PDF, lo verifica sin sesión y otro ente no lo ve (RQ_014)', async ({ page, browser }, testInfo) => {
  await login(page, 'contraloria@sinapsis.co')
  await expect(page.getByTestId('encabezado-rol')).toHaveText('Ente de Control')
  const menu = page.getByRole('navigation', { name: 'Menú principal' })
  await expect(menu.getByRole('link').filter({ hasNotText: 'Inicio' })).toHaveCount(1) // 'Inicio' es común a todos los roles
  await menu.getByRole('link', { name: 'Reportes de Ley' }).click()
  await expect(page.getByRole('heading', { name: 'Reportes de Ley' })).toBeVisible()

  // solo el reporte autorizado para la Contraloría
  await expect(page.getByTestId('form-reporte').getByLabel('Reporte').locator('option')).toHaveCount(1)
  await page.getByRole('button', { name: 'Generar' }).click()
  const vp = page.getByTestId('vista-previa')
  await expect(vp.getByTestId('fila-reporte').first()).toBeVisible()
  const codigo = (await vp.getByTestId('codigo-verificacion').textContent())!.trim()
  const huella = (await vp.getByTestId('huella').textContent())!.trim()
  expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(huella).toMatch(/^[0-9a-f]{64}$/)

  const [d] = await Promise.all([page.waitForEvent('download'), vp.getByRole('button', { name: 'Descargar' }).click()])
  const ruta = testInfo.outputPath('reporte.pdf'); await d.saveAs(ruta)
  const pdf = readFileSync(ruta)
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  expect(sql(`select huella_archivo from reportes.emision where codigo_verificacion='${codigo}'`)).toBe(createHash('sha256').update(pdf).digest('hex'))
  await expect(page.getByTestId('mis-reportes').getByTestId('fila-emision').filter({ hasText: codigo })).toHaveCount(1)

  // verificación pública: contexto nuevo, sin sesión
  const anon = await (await browser.newContext()).newPage()
  await anon.goto(`/verificar/${codigo}`)
  await anon.getByRole('button', { name: 'Verificar' }).click()
  await expect(anon.getByTestId('verificacion-ok')).toContainText('Contraloría (demo)')
  await expect(anon.getByTestId('verificacion-ok')).toContainText(huella)
  await anon.locator('input[type=file]').setInputFiles(ruta)
  await anon.getByRole('button', { name: 'Verificar' }).click()
  await expect(anon.getByTestId('archivo-coincide')).toBeVisible()
  const alterado = testInfo.outputPath('alterado.pdf'); writeFileSync(alterado, Buffer.concat([pdf, Buffer.from('\n% alterado')]))
  await anon.locator('input[type=file]').setInputFiles(alterado)
  await anon.getByRole('button', { name: 'Verificar' }).click()
  await expect(anon.getByTestId('archivo-no-coincide')).toBeVisible()
  await anon.getByLabel('Código de verificación').fill('AAAA-BBBB-CCCC'); await anon.locator('input[type=file]').setInputFiles([])
  await anon.getByRole('button', { name: 'Verificar' }).click()
  await expect(anon.getByTestId('verificacion-error')).toBeVisible()

  // otra organización: no ve el reporte de la Contraloría y tiene su propio catálogo
  const ctx = await browser.newContext(); const otra = await ctx.newPage()
  await login(otra, 'procuraduria@sinapsis.co')
  await otra.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Reportes de Ley' }).click()
  await expect(otra.getByTestId('form-reporte').getByLabel('Reporte').locator('option')).toHaveCount(2)
  await expect(otra.getByTestId('mis-reportes')).not.toContainText(codigo)
  expect(sql(`select count(*) from auditoria.bitacora where accion='GENERAR_REPORTE_LEY' and entidad_id=(select public_id::text from reportes.emision where codigo_verificacion='${codigo}')`)).toBe('1')
})
