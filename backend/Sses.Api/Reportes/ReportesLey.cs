using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Sses.Api.Acompanamiento;
using Sses.Api.Comun;

namespace Sses.Api.Reportes;

public sealed record GenerarReporte(Guid? PlantillaId, int? Vigencia, string? Periodo);

/// <summary>HU_008 / CU_009 / RQ_014: reportes de ley en PDF con huella SHA-256, código de verificación público y aislamiento por organización (RLS).</summary>
public static class ReportesLey
{
    internal sealed record Contenido(string[] Encabezados, string[][] Filas);

    const string SqlBase = @"
        select r.nombre region, c.mes, count(distinct c.tutor_id)::int tutores, sum(c.programadas)::int programadas,
               sum(c.registradas)::int registradas, sum(c.confirmadas)::int confirmadas
        from analitica.mv_cumplimiento_tutor c join maestros.region r on r.id = c.region_id
        where c.mes like @vig || '-%' and (@periodo::text is null or c.mes = @periodo)
        group by r.nombre, c.mes order by c.mes, r.nombre";

    internal static string Pct(int a, int b) => (b == 0 ? 0m : Math.Round(100m * a / b, 1)).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture).Replace('.', ',') + " %";

    /// <summary>Cada código de plantilla está mapeado a una consulta fija y parametrizada (no se ejecuta SQL guardado en la BD).</summary>
    static async Task<Contenido?> Consultar(string codigo, NpgsqlConnection cn, NpgsqlTransaction tx, int vigencia, string? periodo)
    {
        var filas = (await cn.QueryAsync<(string region, string mes, int tutores, int programadas, int registradas, int confirmadas)>(
            SqlBase, new { vig = vigencia.ToString(), periodo }, tx)).ToList();
        return codigo switch
        {
            "CUMPLIMIENTO_REGION" => new(["Región", "Mes", "Tutores", "Programadas", "Registradas", "Cumplimiento"],
                filas.Select(f => new[] { f.region, f.mes, f.tutores.ToString(), f.programadas.ToString(), f.registradas.ToString(), Pct(f.registradas, f.programadas) }).ToArray()),
            "CONFIRMACION_REGION" => new(["Región", "Mes", "Registradas", "Confirmadas u observadas", "% con respuesta del docente"],
                filas.Select(f => new[] { f.region, f.mes, f.registradas.ToString(), f.confirmadas.ToString(), Pct(f.confirmadas, f.registradas) }).ToArray()),
            _ => null
        };
    }

    internal static string Sha256(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    /// <summary>Huella del contenido: SHA-256 de su serialización canónica. Es la que se imprime en el pie del PDF (un archivo no puede contener su propia huella).</summary>
    static string HuellaContenido(string plantilla, string organizacion, int vigencia, string? periodo, Contenido c) =>
        Sha256(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { plantilla, organizacion, vigencia, periodo, c.Encabezados, c.Filas })));

    internal static string NuevoCodigo()
    {
        const string alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos
        var s = new char[12]; for (var i = 0; i < s.Length; i++) s[i] = alfabeto[RandomNumberGenerator.GetInt32(alfabeto.Length)];
        var t = new string(s); return $"{t[..4]}-{t[4..8]}-{t[8..]}";
    }

    /// <summary>PDF/A-2b común a los reportes de ley y al informe mensual del Tutor Líder (D41).</summary>
    internal static byte[] GenerarPdf(string titulo, string subtitulo, string codigo, string huella, string urlVerificacion, Contenido c)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        return Document.Create(d => d.Page(p =>
        {
            p.Size(PageSizes.A4.Landscape()); p.Margin(36); p.DefaultTextStyle(t => t.FontSize(10));
            p.Header().Column(h =>
            {
                h.Item().Text("Sinapsis Andina · SSES").FontSize(9).FontColor(Colors.Grey.Darken1);
                h.Item().Text(titulo).FontSize(18).Bold().FontColor("#0b3a63");
                h.Item().Text(subtitulo).FontSize(9);
                h.Item().PaddingBottom(8);
            });
            p.Content().Table(t =>
            {
                t.ColumnsDefinition(cd => { foreach (var _ in c.Encabezados) cd.RelativeColumn(); });
                t.Header(h => { foreach (var e in c.Encabezados) h.Cell().Background("#0b3a63").Padding(4).Text(e).FontColor(Colors.White).Bold(); });
                foreach (var f in c.Filas) foreach (var v in f) t.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(3).Text(v);
            });
            p.Footer().Column(f =>
            {
                f.Item().Text($"Código de verificación: {codigo} · Verifique en {urlVerificacion}/{codigo}").FontSize(8);
                f.Item().Text($"Huella SHA-256 del contenido: {huella}").FontSize(7).FontColor(Colors.Grey.Darken1);
                f.Item().AlignRight().Text(x => { x.Span("Página ").FontSize(8); x.CurrentPageNumber().FontSize(8); x.Span(" de ").FontSize(8); x.TotalPages().FontSize(8); });
            });
        })).WithSettings(new DocumentSettings { PDFA_Conformance = PDFA_Conformance.PDFA_2B }).GeneratePdf();
    }

    /// <summary>URL pública de verificación: configurada o, por defecto, el origen desde el que se pidió el reporte (D38: local, túnel o nube).</summary>
    internal static string UrlVerificacion(IConfiguration cfg, HttpRequest req)
    {
        if (cfg["Reportes:UrlVerificacion"] is { Length: > 0 } fija) return fija;
        var proto = req.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? req.Scheme;
        var host = req.Headers["X-Forwarded-Host"].FirstOrDefault() ?? req.Host.Value;
        return $"{proto}://{host}/verificar";
    }

    static async Task<long?> OrganizacionDe(NpgsqlConnection cn, long participanteId) =>
        await cn.ExecuteScalarAsync<long?>("select organizacion_id from seguridad.participante where id=@i", new { i = participanteId });

    /// <summary>RQ_001: el aislamiento lo aplica la política RLS de reportes.emision leyendo esta variable de sesión (local a la transacción).</summary>
    static Task FijarOrganizacion(NpgsqlConnection cn, NpgsqlTransaction tx, long org) =>
        cn.ExecuteAsync("select set_config('sses.organizacion_id', @o, true)", new { o = org.ToString() }, tx);

    public static void MapReportesLey(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/v1/reportes-ley").RequireAuthorization(Auth.PEnteControl);

        // RQ_014: plantillas autorizadas para la organización del usuario
        g.MapGet("/plantillas", async (NpgsqlDataSource ds, IUsuarioActual ua) =>
        {
            var u = await ua.ObtenerAsync(); if (u == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            await using var cn = await ds.OpenConnectionAsync();
            var org = await OrganizacionDe(cn, u.ParticipanteId);
            if (org == null) return Problemas.De(403, "SIN_ORGANIZACION", "Tu usuario no tiene una organización de control asignada.");
            var ps = await cn.QueryAsync<(Guid id, string nombre, string descripcion)>(
                @"select p.public_id, p.nombre, p.descripcion from reportes.plantilla p join reportes.plantilla_organizacion po on po.plantilla_id=p.id
                  where po.organizacion_id=@o order by p.nombre", new { o = org });
            var nombre = await cn.ExecuteScalarAsync<string>("select nombre from reportes.organizacion_control where id=@o", new { o = org });
            return Results.Ok(new { organizacion = nombre, plantillas = ps.Select(p => new { id = p.id, nombre = p.nombre, descripcion = p.descripcion }) });
        });

        // RQ_014: genera el reporte (vista previa en JSON + PDF guardado), calcula huellas y registra la emisión
        g.MapPost("/", async (GenerarReporte dto, HttpRequest req, NpgsqlDataSource ds, IUsuarioActual ua, IBitacora bit, IConfiguration cfg) =>
        {
            var u = await ua.ObtenerAsync(); if (u == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            var e = new Dictionary<string, string[]>();
            if (dto.PlantillaId == null) e["plantillaId"] = ["Elige un reporte."];
            if (dto.Vigencia is null or < 2020 or > 2100) e["vigencia"] = ["Elige una vigencia válida (año)."];
            var periodo = string.IsNullOrWhiteSpace(dto.Periodo) ? null : dto.Periodo.Trim();
            if (periodo != null && (!SemanasIso.MesValido(periodo) || !periodo.StartsWith(dto.Vigencia + "-"))) e["periodo"] = ["El periodo debe ser un mes de la vigencia (AAAA-MM)."];
            if (e.Count > 0) return Problemas.Validacion(e);

            await using var cn = await ds.OpenConnectionAsync();
            var org = await OrganizacionDe(cn, u.ParticipanteId);
            if (org == null) return Problemas.De(403, "SIN_ORGANIZACION", "Tu usuario no tiene una organización de control asignada.");
            var pl = await cn.QuerySingleOrDefaultAsync<(long id, string codigo, string nombre)?>(
                @"select p.id, p.codigo, p.nombre from reportes.plantilla p join reportes.plantilla_organizacion po on po.plantilla_id=p.id
                  where p.public_id=@p and po.organizacion_id=@o", new { p = dto.PlantillaId, o = org });
            if (pl == null)
            {
                await bit.RegistrarAsync("ACCESO_DENEGADO", "plantilla", dto.PlantillaId.ToString(), null, new { motivo = "PLANTILLA_NO_AUTORIZADA" });
                return Problemas.De(403, "PLANTILLA_NO_AUTORIZADA", "Ese reporte no está autorizado para tu entidad.");
            }
            var nombreOrg = await cn.ExecuteScalarAsync<string>("select nombre from reportes.organizacion_control where id=@o", new { o = org });

            await using var tx = await cn.BeginTransactionAsync();
            await cn.ExecuteAsync("set local statement_timeout = '30s'", transaction: tx); // RQ_014
            var c = await Consultar(pl.Value.codigo, cn, tx, dto.Vigencia!.Value, periodo);
            if (c == null) return Problemas.De(422, "PLANTILLA_SIN_CONSULTA", "El reporte aún no está parametrizado.");
            var huella = HuellaContenido(pl.Value.nombre, nombreOrg!, dto.Vigencia!.Value, periodo, c);
            var codigo = NuevoCodigo(); var emitida = DateTime.UtcNow;
            var url = UrlVerificacion(cfg, req);
            var pdf = GenerarPdf(pl.Value.nombre, $"Entidad solicitante: {nombreOrg} · Vigencia {dto.Vigencia}{(periodo == null ? "" : " · Periodo " + periodo)} · Emitido {emitida:yyyy-MM-dd HH:mm} UTC", codigo, huella, url, c);
            var huellaArchivo = Sha256(pdf);
            await FijarOrganizacion(cn, tx, org.Value);
            var pub = Guid.CreateVersion7();
            await cn.ExecuteAsync(@"insert into reportes.emision (public_id,organizacion_id,plantilla_id,participante_id,vigencia,periodo,codigo_verificacion,huella_contenido,huella_archivo,filas,pdf,emitida_en)
                values (@p,@o,@pl,@u,@v,@per,@cod,@hc,@ha,@f,@pdf,@em)",
                new { p = pub, o = org, pl = pl.Value.id, u = u.ParticipanteId, v = dto.Vigencia, per = periodo, cod = codigo, hc = huella, ha = huellaArchivo, f = c.Filas.Length, pdf, em = emitida }, tx);
            await bit.RegistrarAsync(cn, tx, "GENERAR_REPORTE_LEY", "reporte", pub.ToString(), null, new { plantilla = pl.Value.codigo, dto.Vigencia, periodo, codigo, huella, filas = c.Filas.Length });
            await tx.CommitAsync();
            return Results.Ok(new
            {
                id = pub, codigo, huella, huellaArchivo, plantilla = pl.Value.nombre, organizacion = nombreOrg, vigencia = dto.Vigencia, periodo, emitidaEn = emitida,
                encabezados = c.Encabezados, filas = c.Filas, descarga = $"/api/v1/reportes-ley/{pub}/pdf"
            });
        });

        // CU_009: 'Mis reportes' — solo emisiones de la organización (la política RLS filtra; no hay WHERE por organización a propósito)
        g.MapGet("/", async (NpgsqlDataSource ds, IUsuarioActual ua) =>
        {
            var u = await ua.ObtenerAsync(); if (u == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            await using var cn = await ds.OpenConnectionAsync();
            var org = await OrganizacionDe(cn, u.ParticipanteId);
            if (org == null) return Problemas.De(403, "SIN_ORGANIZACION", "Tu usuario no tiene una organización de control asignada.");
            await using var tx = await cn.BeginTransactionAsync();
            await FijarOrganizacion(cn, tx, org.Value);
            var filas = await cn.QueryAsync<(Guid id, string plantilla, int vigencia, string? periodo, string codigo, string huella, int filas, DateTime emitida, string emisor)>(
                @"select e.public_id, p.nombre, e.vigencia, e.periodo, e.codigo_verificacion, e.huella_contenido, e.filas, e.emitida_en, pa.nombre
                  from reportes.emision e join reportes.plantilla p on p.id=e.plantilla_id join seguridad.participante pa on pa.id=e.participante_id
                  order by e.emitida_en desc limit 200", transaction: tx);
            await tx.CommitAsync();
            return Results.Ok(new { reportes = filas.Select(f => new { id = f.id, plantilla = f.plantilla, vigencia = f.vigencia, periodo = f.periodo, codigo = f.codigo, huella = f.huella, filas = f.filas, emitidaEn = DateTime.SpecifyKind(f.emitida, DateTimeKind.Utc), emitidoPor = f.emisor }) });
        });

        g.MapGet("/{id:guid}/pdf", async (Guid id, NpgsqlDataSource ds, IUsuarioActual ua, IBitacora bit) =>
        {
            var u = await ua.ObtenerAsync(); if (u == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            await using var cn = await ds.OpenConnectionAsync();
            var org = await OrganizacionDe(cn, u.ParticipanteId);
            if (org == null) return Problemas.De(403, "SIN_ORGANIZACION", "Tu usuario no tiene una organización de control asignada.");
            await using var tx = await cn.BeginTransactionAsync();
            await FijarOrganizacion(cn, tx, org.Value);
            var r = await cn.QuerySingleOrDefaultAsync<(byte[] pdf, string codigo)?>("select pdf, codigo_verificacion from reportes.emision where public_id=@i", new { i = id }, tx);
            if (r == null) return Problemas.NoEncontrado("REPORTE_NO_ENCONTRADO", "El reporte no existe.");
            await bit.RegistrarAsync(cn, tx, "DESCARGAR_REPORTE_LEY", "reporte", id.ToString());
            await tx.CommitAsync();
            return Results.File(r.Value.pdf, "application/pdf", $"reporte-{r.Value.codigo}.pdf");
        });

        // RQ_014: verificación pública por código (sin sesión). Con ?sha256= compara además la huella del archivo que tiene el interesado.
        app.MapGet("/api/v1/reportes-ley/verificar/{codigo}", async (string codigo, string? sha256, NpgsqlDataSource ds, IBitacora bit) =>
        {
            await using var cn = await ds.OpenConnectionAsync();
            var r = await cn.QuerySingleOrDefaultAsync<(string plantilla, string organizacion, int vigencia, string? periodo, DateTime emitida, int filas, string huella_contenido, string huella_archivo)?>(
                "select * from reportes.verificar(@c)", new { c = codigo });
            await bit.RegistrarAsync("VERIFICAR_REPORTE_LEY", "reporte", codigo.Length > 20 ? codigo[..20] : codigo, null, new { encontrado = r != null });
            if (r == null) return Problemas.NoEncontrado("CODIGO_NO_ENCONTRADO", "No existe un reporte con ese código de verificación.");
            return Results.Ok(new
            {
                valido = true, plantilla = r.Value.plantilla, organizacion = r.Value.organizacion, vigencia = r.Value.vigencia, periodo = r.Value.periodo,
                emitidaEn = DateTime.SpecifyKind(r.Value.emitida, DateTimeKind.Utc), filas = r.Value.filas, huella = r.Value.huella_contenido, huellaArchivo = r.Value.huella_archivo,
                coincideArchivo = string.IsNullOrWhiteSpace(sha256) ? (bool?)null : string.Equals(sha256.Trim(), r.Value.huella_archivo, StringComparison.OrdinalIgnoreCase)
            });
        }).AllowAnonymous();
    }
}
