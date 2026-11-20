using Sses.Api.Analitica;
using Sses.Api.Reportes;
using FluentValidation;
using Npgsql;
using Sses.Api.Maestros;
using Sses.Api.Acompanamiento;
using Sses.Api.Auditoria;
using Sses.Api.Comun;
using Sses.Api.Estrategias;
using Sses.Api.Mesa;
using Sses.Api.Seguridad;
using Sses.Api.Sincronizacion;

Datos.Configurar();
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(builder.Configuration.GetConnectionString("Sses")).Build());
builder.Services.AddSingleton<IProteccionDatos>(_ => ProteccionDatos.DesdeConfiguracion(builder.Configuration));
builder.Services.AddScoped<IUsuarioActual, UsuarioActual>();
builder.Services.AddScoped<IBitacora, Bitacora>();
builder.Services.AddHostedService<Sses.Api.Analitica.RefrescoAnalitica>();
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<IValidator<EstrategiaCrear>, EstrategiaCrearValidator>();
builder.Services.AddSingleton<IValidator<EstrategiaEditar>, EstrategiaEditarValidator>();
builder.Services.AddSingleton<Vigencia>();
builder.AgregarAuth();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins((builder.Configuration["Cors:Origins"] ?? "http://localhost:5173").Split(',', StringSplitOptions.RemoveEmptyEntries))
    .AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("ETag", "Location", "Server-Timing")));

var app = builder.Build();
app.Use(async (ctx, next) => { ctx.Response.Headers["X-Content-Type-Options"] = "nosniff"; await next(); });
app.UseExceptionHandler(e => e.Run(async ctx =>
{
    var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    if (ex != null) ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Sses.Api").LogError(ex, "Error no controlado en {Metodo} {Ruta}", ctx.Request.Method, ctx.Request.Path);
    ctx.Response.StatusCode = 500; ctx.Response.ContentType = "application/problem+json";
    await ctx.Response.WriteAsJsonAsync(new { title = "Ocurrió un error inesperado.", status = 500, code = "ERROR_INTERNO" });
}));
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.MapGet("/health/live", () => Results.Ok(new { estado = "vivo" }));
app.MapGet("/health/ready", async (IConfiguration cfg, IHttpClientFactory http, NpgsqlDataSource ds, CancellationToken ct) =>
{
    var problemas = new List<string>();
    try { await using var cn = await ds.OpenConnectionAsync(ct); await using var cmd = new NpgsqlCommand("select 1", cn); await cmd.ExecuteScalarAsync(ct); }
    catch (Exception ex) { problemas.Add("db: " + ex.GetType().Name); }
    try
    {
        var meta = cfg["Keycloak:MetadataAddress"];
        if (!string.IsNullOrEmpty(meta)) { var r = await http.CreateClient().GetAsync(meta, ct); if (!r.IsSuccessStatusCode) problemas.Add("keycloak: " + (int)r.StatusCode); }
    }
    catch (Exception ex) { problemas.Add("keycloak: " + ex.GetType().Name); }
    return problemas.Count == 0 ? Results.Ok(new { estado = "listo" }) : Results.Json(new { estado = "no_listo", problemas }, statusCode: 503);
});

app.MapSesion();
app.MapMaestros();
app.MapEstrategias();
app.MapBusquedaEstudiantes();
app.MapAcompanamiento();
app.MapSeguimientos();
app.MapEvidencias();
app.MapSincronizacion();
app.MapMiAcompanamiento();
app.MapAnalitica(); app.MapReportesLey();
app.MapDesempeno(); app.MapInformeMensual(); // D40, D41
app.MapAuditoria();
app.MapIncidentes();
app.Run();

public partial class Program;
