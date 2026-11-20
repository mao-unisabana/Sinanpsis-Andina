using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using Sses.Api.Acompanamiento;
using Sses.Api.Comun;

namespace Sses.Api.Reportes;

public sealed record GenerarInformeMensual(string? Mes);

/// <summary>D41: informe mensual del acompañamiento del Tutor Líder en PDF, con código de verificación público y huella SHA-256
/// (mismo mecanismo de RQ_014). Resume, semana a semana, lo programado, lo registrado (en línea o sin señal) y lo confirmado por los docentes.</summary>
public static class InformeMensual
{
    sealed class Semana
    {
        public string Estrategia { get; set; } = ""; public string Modalidad { get; set; } = ""; public short Numero { get; set; }
        public DateOnly Inicio { get; set; } public DateOnly Fin { get; set; } public string Estado { get; set; } = ""; public string? Origen { get; set; }
        public DateTime? Capturado { get; set; } public int Asistieron { get; set; } public int Docentes { get; set; } public int Confirmaron { get; set; }
    }

    public static void MapInformeMensual(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/v1/tutores/me/informe-mensual").RequireAuthorization(Auth.PTutorLider);

        // RQ_010, RQ_011, RQ_014: POST /api/v1/tutores/me/informe-mensual {mes}
        g.MapPost("/", async (GenerarInformeMensual dto, HttpRequest req, NpgsqlDataSource ds, IUsuarioActual ua, IBitacora bit, IConfiguration cfg) =>
        {
            var u = await ua.ObtenerAsync(); if (u?.PersonaId == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            if (!SemanasIso.MesValido(dto.Mes)) return Problemas.Validacion(new Dictionary<string, string[]> { ["mes"] = ["Elige un mes válido (AAAA-MM)."] });
            await using var cn = await ds.OpenConnectionAsync(); await using var tx = await cn.BeginTransactionAsync();
            var semanas = (await cn.QueryAsync<Semana>(@"
                select e.nombre estrategia, p.modalidad, h.numero_semana numero, h.fecha_inicio inicio, h.fecha_fin fin, h.estado, s.origen, s.capturado_en capturado,
                       (select count(*) from acompanamiento.asistencia_seguimiento a where a.seguimiento_id = s.id and a.asistio)::int asistieron,
                       (select count(*) from acompanamiento.plan_docente pd where pd.plan_id = p.id)::int docentes,
                       (select count(*) from acompanamiento.confirmacion_docente c where c.hito_id = h.id and c.confirmado)::int confirmaron
                from acompanamiento.hito_semanal h join acompanamiento.plan p on p.id = h.plan_id join estrategias.estrategia e on e.id = p.estrategia_id
                left join lateral (select ss.id, ss.origen, ss.capturado_en from acompanamiento.seguimiento_semanal ss where ss.hito_id = h.id order by ss.registrado_en desc limit 1) s on true
                where p.tutor_id = @t and p.mes = @mes order by e.nombre, h.numero_semana", new { t = u.PersonaId, mes = dto.Mes }, tx)).ToList();
            if (semanas.Count == 0) return Problemas.De(422, "MES_SIN_PLAN", "No tienes acompañamientos programados en ese mes.");

            static string Estado(string e) => e switch { "PROGRAMADA" => "Programada", "REGISTRADA" => "Registrada", "CONFIRMADO" => "Confirmada por el docente", "OBSERVADO" => "Observada", _ => e };
            var filas = semanas.Select(s => new[]
            {
                s.Estrategia, s.Modalidad == "GRUPAL" ? "Grupal" : "Individual", $"Semana {s.Numero} ({s.Inicio:dd/MM}–{s.Fin:dd/MM})", Estado(s.Estado),
                s.Origen == null ? "—" : $"{(s.Origen == "SIN_CONEXION" ? "Sin conexión" : "En línea")} · {s.Capturado:dd/MM HH:mm}",
                s.Origen == null ? "—" : $"{s.Asistieron} de {s.Docentes}", s.Origen == null ? "—" : $"{s.Confirmaron} de {s.Docentes}"
            }).ToArray();
            var c = new ReportesLey.Contenido(["Estrategia", "Modalidad", "Semana", "Estado", "Registro", "Asistieron", "Confirmaron"], filas);
            var registradas = semanas.Count(s => s.Estado != "PROGRAMADA");
            var huella = ReportesLey.Sha256(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { tipo = "INFORME_MENSUAL", tutor = u.PublicId, mes = dto.Mes, c.Encabezados, c.Filas })));
            var codigo = ReportesLey.NuevoCodigo(); var emitido = DateTime.UtcNow;
            var subtitulo = $"Tutor Líder: {u.Nombre} · Mes {dto.Mes} · Cumplimiento {ReportesLey.Pct(registradas, semanas.Count)} ({registradas} de {semanas.Count} semanas) · Sin conexión: {semanas.Count(s => s.Origen == "SIN_CONEXION")} · Emitido {emitido:yyyy-MM-dd HH:mm} UTC";
            var pdf = ReportesLey.GenerarPdf("Informe mensual del acompañamiento pedagógico", subtitulo, codigo, huella, ReportesLey.UrlVerificacion(cfg, req), c);
            var pub = Guid.CreateVersion7();
            await cn.ExecuteAsync(@"insert into reportes.informe_mensual (public_id, participante_id, mes, codigo_verificacion, huella_contenido, huella_archivo, filas, pdf, emitido_en)
                values (@p, @u, @mes, @cod, @hc, @ha, @f, @pdf, @em)",
                new { p = pub, u = u.ParticipanteId, mes = dto.Mes, cod = codigo, hc = huella, ha = ReportesLey.Sha256(pdf), f = filas.Length, pdf, em = emitido }, tx);
            await bit.RegistrarAsync(cn, tx, "GENERAR_INFORME_MENSUAL", "informe", pub.ToString(), null, new { mes = dto.Mes, codigo, huella, semanas = semanas.Count });
            await tx.CommitAsync();
            return Results.Ok(new { id = pub, codigo, huella, mes = dto.Mes, descarga = $"/api/v1/tutores/me/informe-mensual/{pub}/pdf" });
        });

        // Descarga: solo el tutor que lo emitió
        g.MapGet("/{id:guid}/pdf", async (Guid id, NpgsqlDataSource ds, IUsuarioActual ua, IBitacora bit) =>
        {
            var u = await ua.ObtenerAsync(); if (u == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            await using var cn = await ds.OpenConnectionAsync();
            var r = await cn.QuerySingleOrDefaultAsync<(byte[] pdf, string codigo)?>(
                "select pdf, codigo_verificacion from reportes.informe_mensual where public_id=@i and participante_id=@u", new { i = id, u = u.ParticipanteId });
            if (r == null) return Problemas.NoEncontrado("INFORME_NO_ENCONTRADO", "El informe no existe.");
            await bit.RegistrarAsync(cn, null, "DESCARGAR_INFORME_MENSUAL", "informe", id.ToString());
            return Results.File(r.Value.pdf, "application/pdf", $"informe-{r.Value.codigo}.pdf");
        });
    }
}
