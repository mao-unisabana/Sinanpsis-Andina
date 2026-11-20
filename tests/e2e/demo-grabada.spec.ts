// Ensayo grabado del guion de la exposición (Piloto SSES en vivo). Genera videos en tests/e2e/grabaciones/.
// Uso: npx playwright test demo-grabada.spec.ts   (stack arriba). Solo para ensayar: en la sustentación se muestra el software, nunca un video.
import { test, expect, devices } from '@playwright/test'
import { login, programarPlanDemo, registrarSemana, sql, resetDemo, DEMO_PASSWORD } from './helpers'

const DIR = 'grabaciones'
const pausa = (p: { waitForTimeout(ms: number): Promise<void> }, ms = 1800) => p.waitForTimeout(ms)
const nombre = `Semillero Demo ${Date.now().toString().slice(-5)}`

test.use({ launchOptions: { slowMo: 350 } })
test.describe.serial('Demo grabada', () => {
  test.setTimeout(420_000)
  test.beforeAll(() => { resetDemo() })

  test('Tramos 1-3 · Laura (Gestora)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'es-CO', viewport: { width: 1366, height: 768 },
      recordVideo: { dir: DIR, size: { width: 1366, height: 768 } } })
    const page = await ctx.newPage()
    try {
      // Tramo 1 · código equivocado no entra
      await page.goto('/'); await pausa(page)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await page.locator('#username').fill('gestor.demo@sinapsis.co')
      await page.locator('#password').fill(DEMO_PASSWORD); await page.locator('#kc-login').click()
      await page.locator('#otp').fill('000000'); await pausa(page, 1200); await page.locator('#kc-login').click()
      await expect(page.getByTestId('encabezado-nombre')).toHaveCount(0); await pausa(page, 3000)
      await ctx.clearCookies()
      // código correcto + perfil
      await login(page, 'gestor.demo@sinapsis.co', 0)
      await expect(page.getByTestId('encabezado-nombre')).toHaveText('Laura Gestora')
      await pausa(page, 4000)

      // Tramo 2 · nueva estrategia, errores, guardar, editar
      await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Estrategias' }).click(); await pausa(page)
      await page.getByRole('button', { name: 'Nueva estrategia' }).click()
      await page.getByLabel('Entidad').selectOption({ label: 'Fundación Semillas del Pacífico' })
      await page.getByLabel('Nombre').fill('semillero de robótica pacífico')
      await page.getByLabel('Objetivo').fill('Fortalecer el pensamiento computacional en estudiantes de Tumaco.')
      await page.getByLabel('Población').fill('Estudiantes de 10 a 14 años')
      await page.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(page.getByText('Ya existe una estrategia con ese nombre en la entidad.')).toBeVisible(); await pausa(page, 3500)
      await page.getByLabel('Nombre').fill(nombre)
      await page.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(page.getByTestId('estado-estrategia')).toHaveText('Editable'); await pausa(page, 3000)
      await page.getByRole('button', { name: 'Editar' }).click()
      await page.getByLabel('Población').fill('Estudiantes de 10 a 15 años')
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Estudiantes de 10 a 15 años')).toBeVisible(); await pausa(page, 2500)

      // Tramo 3 · buscar entre 500.000, no existe, vincular 2, bloqueo
      await page.getByRole('tab', { name: 'Estudiantes vinculados' }).click()
      await page.getByRole('button', { name: 'Asociar estudiantes' }).click()
      await page.getByLabel('Número de documento').fill('1001234567'); await page.getByRole('button', { name: 'Buscar' }).click()
      await expect(page.getByTestId('resultados-busqueda')).toContainText('Camila R.'); await pausa(page, 3500)
      await page.getByLabel('Número de documento').fill('1001234568'); await page.getByRole('button', { name: 'Buscar' }).click()
      await expect(page.getByTestId('resultados-busqueda').locator('li')).toHaveCount(2); await pausa(page)
      await page.getByLabel('Número de documento').fill('9999999999'); await page.getByRole('button', { name: 'Buscar' }).click()
      await expect(page.getByText('No encontramos un estudiante con ese documento.')).toBeVisible(); await pausa(page, 3000)
      await page.getByRole('button', { name: 'Vincular' }).click()
      await expect(page.getByTestId('estado-estrategia')).toContainText('Bloqueada para edición'); await pausa(page, 4000)
      await page.getByRole('tab', { name: 'Datos' }).click()
      await expect(page.getByRole('button', { name: 'Editar' })).toBeDisabled(); await pausa(page, 2500)
    } finally { await ctx.close() }
  })

  test('Tramos 4-5 · Andrés (Tutor Líder, móvil)', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-CO',
      recordVideo: { dir: DIR, size: { width: 412, height: 915 } } })
    const page = await ctx.newPage()
    try {
      await login(page, 'tutor.lider@sinapsis.co', 0, true); await pausa(page)
      // Tramo 4 · plan mensual grupal, offline, registro con foto → Pendiente
      await programarPlanDemo(page, [1, 2, 3])
      await expect(page.getByTestId('cumplimiento-porcentaje')).toHaveText('0 %'); await pausa(page, 3000)
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 })
      await ctx.setOffline(true); await page.reload()
      await expect(page.getByTestId('aviso-sin-conexion')).toHaveText('Sin conexión: tus registros se guardarán en este dispositivo'); await pausa(page, 3500)
      await registrarSemana(page, 1, 'Taller de planeación con los docentes de Tumaco', true)
      await expect(page.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Pendiente'); await pausa(page, 4000)

      // Tramo 5 · reconectar → Sincronizado 33 %, Ayuda → INC, Bitácora
      await ctx.setOffline(false)
      await expect(page.getByTestId('hito').nth(0).getByTestId('estado-registro')).toHaveText('Sincronizado', { timeout: 30_000 })
      await expect(page.getByTestId('cumplimiento-porcentaje')).toHaveText('33 %'); await pausa(page, 4000)
      await page.getByTestId('boton-ayuda').click()
      await page.getByLabel('Tipo de inconveniente').selectOption('BLOQUEANTE')
      await page.getByLabel('¿Qué pasó?').fill('No carga la foto')
      await page.getByRole('button', { name: 'Enviar' }).click()
      const numero = (await page.getByTestId('numero-caso').textContent())!.trim()
      expect(numero).toMatch(/^INC-\d{4}-\d{6}$/); await pausa(page, 3500)
      await page.getByRole('link', { name: 'Mis casos' }).click()
      await expect(page.getByTestId('lista-casos')).toContainText(numero); await pausa(page, 3500)
      await page.goto('/auditoria')
      await expect(page.getByTestId('eventos').locator('li').first()).toBeVisible(); await pausa(page)
      await page.getByRole('button', { name: 'Verificar cadena' }).click()
      await expect(page.getByTestId('cadena-ok')).toHaveText('Cadena íntegra ✓'); await pausa(page, 4000)
      expect(sql('select ok from auditoria.verificar_cadena()')).toBe('t')
    } finally { await ctx.close() }
  })
})
