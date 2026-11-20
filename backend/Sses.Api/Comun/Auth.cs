using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace Sses.Api.Comun;

public static class Roles
{
    public const string Admin = "ADMIN_FUNCIONAL", Gestor = "GESTOR_ESTRATEGIAS", TutorLider = "TUTOR_LIDER", TutorDocente = "TUTOR_DOCENTE", Analista = "ANALISTA_MEN", EnteControl = "ENTE_CONTROL";
}

public static class Auth
{
    public const string PGestor = "Gestor", PTutorLider = "TutorLider", PTutorDocente = "TutorDocente", PAnalista = "Analista", PEnteControl = "EnteControl", PAutenticado = "Autenticado";

    /// <summary>RQ_003: valida firma, emisor, audiencia y expiración del JWT emitido por Keycloak.</summary>
    public static void AgregarAuth(this WebApplicationBuilder b)
    {
        var cfg = b.Configuration;
        b.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.MetadataAddress = cfg["Keycloak:MetadataAddress"]!;
            o.RequireHttpsMetadata = false;
            o.MapInboundClaims = false;
            // D38: Keycloak se publica en el mismo origen que la web, así que el emisor cambia según la URL de acceso
            // (localhost, túnel o nube). Se acepta cualquier emisor del realm `sses`; la firma (JWKS interno), la audiencia
            // y la vigencia se siguen validando.
            var sufijo = cfg["Keycloak:IssuerSufijo"] ?? "/realms/sses";
            o.TokenValidationParameters = new()
            {
                IssuerValidator = (emisor, _, _) => Uri.TryCreate(emisor, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http") && u.AbsolutePath.TrimEnd('/') == sufijo
                    ? emisor : throw new Microsoft.IdentityModel.Tokens.SecurityTokenInvalidIssuerException($"Emisor no admitido: {emisor}"),
                ValidAudience = cfg["Keycloak:Audience"],
                ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "preferred_username", RoleClaimType = ClaimTypes.Role
            };
        });
        b.Services.AddTransient<Microsoft.AspNetCore.Authentication.IClaimsTransformation, RolesDesdeRealm>();
        b.Services.AddAuthorizationBuilder()
            .AddPolicy(PAutenticado, p => p.RequireAuthenticatedUser())
            .AddPolicy(PGestor, p => p.RequireRole(Roles.Gestor))
            .AddPolicy(PTutorLider, p => p.RequireRole(Roles.TutorLider))
            .AddPolicy(PTutorDocente, p => p.RequireRole(Roles.TutorDocente))
            .AddPolicy(PAnalista, p => p.RequireRole(Roles.Analista))
            .AddPolicy(PEnteControl, p => p.RequireRole(Roles.EnteControl));
        b.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, ResultadoAutorizacion>();
    }
}

/// <summary>Mapea realm_access.roles (Keycloak) a ClaimTypes.Role.</summary>
public sealed class RolesDesdeRealm : Microsoft.AspNetCore.Authentication.IClaimsTransformation
{
    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity is not ClaimsIdentity id || !id.IsAuthenticated || id.HasClaim(c => c.Type == ClaimTypes.Role)) return Task.FromResult(principal);
        var raw = id.FindFirst("realm_access")?.Value;
        if (raw != null)
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("roles", out var roles))
                foreach (var r in roles.EnumerateArray()) if (r.GetString() is { } s) id.AddClaim(new Claim(ClaimTypes.Role, s));
        }
        return Task.FromResult(principal);
    }
}

/// <summary>403 con Problem Details y bitácora ACCESO_DENEGADO (RQ_005).</summary>
public sealed class ResultadoAutorizacion : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _def = new();
    public async Task HandleAsync(RequestDelegate next, HttpContext ctx, AuthorizationPolicy policy, PolicyAuthorizationResult result)
    {
        if (result.Forbidden)
        {
            try { await ctx.RequestServices.GetRequiredService<IBitacora>().RegistrarAsync("ACCESO_DENEGADO", "endpoint", $"{ctx.Request.Method} {ctx.Request.Path}"); }
            catch { /* la denegación no debe fallar si la bitácora falla */ }
            ctx.Response.StatusCode = 403; ctx.Response.ContentType = "application/problem+json";
            await ctx.Response.WriteAsJsonAsync(new { type = "https://sses.sinapsis.co/errores/ACCESO_DENEGADO", title = "No tienes permiso para esta operación.", status = 403, code = "ACCESO_DENEGADO" });
            return;
        }
        await _def.HandleAsync(next, ctx, policy, result);
    }
}
