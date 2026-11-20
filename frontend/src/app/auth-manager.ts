import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import { config } from './config'

// D16: el usuario/tokens viven en sessionStorage (no sobreviven al cierre de la pestaña); el estado PKCE también.
export const userManager = new UserManager({
  authority: config.authority,
  client_id: 'sses-web',
  redirect_uri: `${window.location.origin}/auth/callback`,
  silent_redirect_uri: `${window.location.origin}/auth/callback`, // renovación silenciosa en iframe (mismo origen, D38)
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code', // Authorization Code + PKCE S256
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
  silentRequestTimeoutInSeconds: 6,
  filterProtocolClaims: true,
})

let cached: User | null = null
userManager.events.addUserLoaded((u) => { cached = u })
userManager.events.addUserUnloaded(() => { cached = null })

export async function getAccessToken(): Promise<string | null> {
  if (!cached || cached.expired) cached = await userManager.getUser()
  if (cached?.expired) {
    try { cached = await userManager.signinSilent() } catch { return null }
  }
  return cached?.access_token ?? null
}
