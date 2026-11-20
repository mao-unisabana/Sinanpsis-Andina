import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Sinapsis2026!Demo'
export const DEMO_TOTP_SECRET = process.env.DEMO_TOTP_SECRET ?? 'KNUW4YLQONUXGQLOMRUW4YKEMVWW6MBR'
export const API = process.env.API_URL ?? 'http://localhost:5080/api/v1'
export const KC = process.env.KC_URL ?? 'http://localhost:8180'

function base32Decode(s: string) {
  const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = '', out: number[] = []
  for (const c of s.replace(/=+$/, '')) bits += al.indexOf(c).toString(2).padStart(5, '0')
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
export function totp(secret = DEMO_TOTP_SECRET, offset = 0, now = Date.now()) {
  const counter = Math.floor(now / 30000) + offset
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000
  return String(code).padStart(6, '0')
}

// Contador TOTP usado por usuario, persistido entre corridas (Keycloak no admite reutilizar un código)
const ESTADO = new URL('./.totp-state.json', import.meta.url)
const leer = (): Record<string, number> => { try { return JSON.parse(readFileSync(ESTADO, 'utf8')) } catch { return {} } }
const ultimo = { get: (k: string) => leer()[k], set: (k: string, v: number) => writeFileSync(ESTADO, JSON.stringify({ ...leer(), [k]: v })) }

/** Ingresa por Keycloak (correo + contraseña + TOTP). Reintenta en la siguiente ventana si el código ya se usó. */
export async function login(page: Page, correo: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.locator('#username').fill(correo)
  await page.locator('#password').fill(DEMO_PASSWORD)
  await page.locator('#kc-login').click()
  // Keycloak rechaza reutilizar un código: se usan contadores estrictamente crecientes por usuario (lookAhead 1)
  let ahora = Math.floor(Date.now() / 30000)
  const prev = ultimo.get(correo)
  const c = prev === undefined ? ahora : Math.max(prev + 1, ahora - 1)
  if (c > ahora + 1) { await page.waitForTimeout((c - 1) * 30000 - Date.now() + 500); ahora = Math.floor(Date.now() / 30000) }
  ultimo.set(correo, c)
  await page.locator('#otp').fill(totp(undefined, c - ahora))
  await page.locator('#kc-login').click()
  await page.waitForURL(/\/inicio/, { timeout: 15000 })
  await expect(page.getByTestId('encabezado-nombre')).toBeVisible()
}

export async function tokenDe(page: Page): Promise<string> {
  const t = await page.evaluate(() => {
    const k = Object.keys(sessionStorage).find((x) => x.startsWith('oidc.user:'))
    return k ? (JSON.parse(sessionStorage.getItem(k)!) as { access_token: string }).access_token : null
  })
  if (!t) throw new Error('Sin token en sessionStorage')
  return t
}

/** Admin de Keycloak (solo para pruebas): limpia el bloqueo por fuerza bruta de un usuario. */
export async function limpiarBloqueos(request: import('@playwright/test').APIRequestContext) {
  const tk = await request.post(`${KC}/realms/master/protocol/openid-connect/token`, {
    form: { grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN ?? 'admin', password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin' } })
  const { access_token } = await tk.json()
  await request.delete(`${KC}/admin/realms/sses/attack-detection/brute-force/users`, { headers: { Authorization: `Bearer ${access_token}` } })
}

/** Tutor líder programa un plan grupal con los 3 primeros docentes en las semanas indicadas (mes actual). */
export async function programarPlanDemo(page: Page, semanas = [1, 2, 3]) {
  await page.getByRole('navigation').getByRole('link', { name: 'Acompañamientos' }).click() // menú lateral (escritorio) o barra inferior (móvil)
  const form = page.getByTestId('form-programar')
  await expect(form.getByText('Marina Docente')).toBeVisible()
  for (const i of [0, 1, 2]) await form.getByRole('checkbox').nth(i).check()
  await form.getByLabel('Temas').fill('Planeación de clases y evaluación formativa')
  for (const n of semanas) await form.getByLabel(`Semana ${n}`).check({ force: true })
  await form.getByRole('button', { name: 'Programar' }).click()
  await expect(page.getByTestId('calendario').getByTestId('hito')).toHaveCount(semanas.length)
}

/** Crea en el navegador una imagen PNG ruidosa (pesada) y la entrega al input de fotos. Devuelve su tamaño original en bytes. */
export async function adjuntarFotoPesada(page: Page, ancho = 3000, alto = 2000): Promise<number> {
  return page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')!; const d = ctx.createImageData(w, h)
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255 }
    ctx.putImageData(d, 0, 0)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'grande.png', { type: 'image/png' }))
    const input = document.querySelector('[data-testid=input-fotos]') as HTMLInputElement
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    return blob.size
  }, [ancho, alto] as const)
}

/** Deja la base en el estado del guion. En Windows, Node usa cmd.exe y no ejecuta .sh: se invoca Git Bash. */
export function resetDemo() {
  const gitBash = 'C:/Program Files/Git/bin/bash.exe'
  const cmd = process.platform === 'win32' ? `"${existsSync(gitBash) ? gitBash : 'bash'}" scripts/reset-demo.sh` : './scripts/reset-demo.sh'
  execSync(cmd, { cwd: '../..', stdio: 'pipe' })
}

export const sql = (q: string) => execSync(`docker compose exec -T postgres psql -U postgres -d sses -Atc "${q}"`, { cwd: '../..' }).toString().trim()
export const mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export async function registrarSemana(page: Page, n: number, actividades: string, foto = false) {
  await page.getByTestId('hito').nth(n - 1).getByRole('button', { name: 'Registrar seguimiento' }).click()
  await expect(page.getByRole('heading', { name: 'Registrar seguimiento' })).toBeVisible()
  await page.getByLabel(/Asistió Marina/).check()
  await page.getByLabel('Actividades').fill(actividades)
  await page.getByLabel('Avances').fill('Avance registrado en campo')
  if (foto) { await adjuntarFotoPesada(page, 1600, 1200); await expect(page.getByTestId('peso-foto')).toBeVisible({ timeout: 60_000 }) }
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Plan mensual' })).toBeVisible()
}

