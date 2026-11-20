using Dapper;
using Npgsql;
using Sses.Api.Comun;

namespace Sses.Api.Acompanamiento;

/// <summary>D40: "Mi desempeño" del Tutor Líder: su cumplimiento mes a mes, el trabajo capturado sin señal y lo que confirmaron sus docentes.
/// Mismas definiciones que el tablero del Analista (RQ_013, D24), calculadas solo sobre los planes del tutor del token.</summary>
public static class Desempeno
{
    const string ZonaBogota = "America/Bogota";

    public sealed class Mes
    {
        public string MesClave { get; set; } = ""; public int Programadas { get; set; } public int Registradas { get; set; }
        public int Confirmadas { get; set; } public int Observadas { get; set; } public int SinConexion { get; set; } public int EnLinea { get; set; }
        public int ATiempo { get; set; } public int DocentesAtendidos { get; set; }
    }

    /// <summary>Serie de los últimos <paramref name="meses"/> meses (incluido el actual) para el tutor.</summary>
    public static async Task<List<Mes>> Serie(NpgsqlConnection cn, long tutorId, int meses, NpgsqlTransaction? tx = null)
    {
        var serie = (await cn.QueryAsync<Mes>($@"
            with meses as (
              select to_char(g, 'YYYY-MM') mes from generate_series(
                date_trunc('month', now() at time zone '{ZonaBogota}') - (@n - 1) * interval '1 month',
                date_trunc('month', now() at time zone '{ZonaBogota}'), interval '1 month') g)
            select m.mes mes_clave,
                   count(h.id)::int programadas,
                   count(h.id) filter (where h.estado <> 'PROGRAMADA')::int registradas,
                   count(h.id) filter (where h.estado = 'CONFIRMADO')::int confirmadas,
                   count(h.id) filter (where h.estado = 'OBSERVADO')::int observadas,
                   count(s.id) filter (where s.origen = 'SIN_CONEXION')::int sin_conexion,
                   count(s.id) filter (where s.origen = 'EN_LINEA')::int en_linea,
                   -- D24 con la fecha de captura: lo registrado sin señal cuenta el día en que se hizo, no el de la sincronización
                   count(h.id) filter (where h.estado <> 'PROGRAMADA' and (s.capturado_en at time zone '{ZonaBogota}')::date <= h.fecha_fin + 2)::int a_tiempo
            from meses m
            left join acompanamiento.plan p on p.mes = m.mes and p.tutor_id = @t
            left join acompanamiento.hito_semanal h on h.plan_id = p.id
            left join lateral (select ss.id, ss.origen, ss.capturado_en from acompanamiento.seguimiento_semanal ss
                               where ss.hito_id = h.id order by ss.registrado_en desc limit 1) s on true
            group by m.mes order by m.mes", new { t = tutorId, n = meses }, tx)).ToList();
        var atendidos = (await cn.QueryAsync<(string mes, int docentes)>(@"
            select p.mes, count(distinct a.docente_id)::int from acompanamiento.plan p
            join acompanamiento.hito_semanal h on h.plan_id = p.id join acompanamiento.seguimiento_semanal s on s.hito_id = h.id
            join acompanamiento.asistencia_seguimiento a on a.seguimiento_id = s.id and a.asistio
            where p.tutor_id = @t group by p.mes", new { t = tutorId }, tx)).ToDictionary(x => x.mes, x => x.docentes);
        foreach (var m in serie) m.DocentesAtendidos = atendidos.GetValueOrDefault(m.MesClave);
        return serie;
    }

    static decimal Pct(int a, int b) => b == 0 ? 0m : Math.Round(100m * a / b, 1);

    public static void MapDesempeno(this IEndpointRouteBuilder app)
    {
        // RQ_010, RQ_011, RQ_012, RQ_013: GET /api/v1/tutores/me/desempeno?meses=6
        app.MapGroup("/api/v1/tutores/me").RequireAuthorization(Auth.PTutorLider).MapGet("/desempeno", async (int? meses, NpgsqlDataSource ds, IUsuarioActual ua, IBitacora bit) =>
        {
            var u = await ua.ObtenerAsync(); if (u?.PersonaId == null) return Problemas.De(403, "USUARIO_NO_HABILITADO", "Tu usuario no está habilitado.");
            var n = Math.Clamp(meses ?? 6, 1, 12);
            await using var cn = await ds.OpenConnectionAsync();
            var serie = await Serie(cn, u.PersonaId.Value, n);
            var actual = serie[^1];
            // Semanas ya vencidas que siguen sin registro, y semanas registradas que el docente aún no confirma
            const string Vencidas = $"from acompanamiento.hito_semanal h join acompanamiento.plan p on p.id = h.plan_id join estrategias.estrategia e on e.id = p.estrategia_id where p.tutor_id = @t and h.estado = 'PROGRAMADA' and h.fecha_fin < (now() at time zone '{ZonaBogota}')::date";
            var porRegistrar = await cn.QueryAsync<(Guid id, string mes, short numero, DateOnly inicio, DateOnly fin, string estrategia)>(
                $"select h.public_id, p.mes, h.numero_semana, h.fecha_inicio, h.fecha_fin, e.nombre {Vencidas} order by h.fecha_fin desc limit 5", new { t = u.PersonaId });
            var totalPorRegistrar = await cn.ExecuteScalarAsync<int>($"select count(*)::int {Vencidas}", new { t = u.PersonaId });
            var porConfirmar = await cn.ExecuteScalarAsync<int>(@"select count(*)::int from acompanamiento.hito_semanal h join acompanamiento.plan p on p.id = h.plan_id
                where p.tutor_id = @t and h.estado = 'REGISTRADA'", new { t = u.PersonaId });
            await bit.RegistrarAsync(cn, null, "CONSULTAR_DESEMPENO", "tutor", u.PublicId.ToString(), null, new { meses = n });
            var totalReg = serie.Sum(m => m.Registradas);
            return Results.Ok(new
            {
                mesActual = actual.MesClave,
                indicadores = new
                {
                    cumplimientoMes = Pct(actual.Registradas, actual.Programadas),
                    registradasMes = actual.Registradas, programadasMes = actual.Programadas,
                    sinConexionPeriodo = serie.Sum(m => m.SinConexion), registrosPeriodo = serie.Sum(m => m.SinConexion + m.EnLinea),
                    confirmacionPeriodo = Pct(serie.Sum(m => m.Confirmadas), totalReg),
                    regularidadPeriodo = Pct(serie.Sum(m => m.ATiempo), totalReg),
                    porConfirmar, docentesAtendidosMes = actual.DocentesAtendidos
                },
                meses = serie.Select(m => new
                {
                    mes = m.MesClave, programadas = m.Programadas, registradas = m.Registradas, confirmadas = m.Confirmadas, observadas = m.Observadas,
                    sinConexion = m.SinConexion, enLinea = m.EnLinea, docentesAtendidos = m.DocentesAtendidos,
                    cumplimiento = Pct(m.Registradas, m.Programadas), regularidad = Pct(m.ATiempo, m.Registradas)
                }),
                totalPorRegistrar,
                porRegistrar = porRegistrar.Select(h => new { hitoId = h.id, mes = h.mes, numeroSemana = (int)h.numero, fechaInicio = h.inicio, fechaFin = h.fin, estrategia = h.estrategia })
            });
        });
    }
}
