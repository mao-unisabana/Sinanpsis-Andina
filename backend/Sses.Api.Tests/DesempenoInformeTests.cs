using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Sses.Api.Tests;

/// <summary>D40 "Mi desempeño" y D41 informe mensual del Tutor Líder.</summary>
[Collection("sses")]
public class DesempenoInformeTests(SsesFixtureInicial fx)
{
    SsesFixture F => fx.F;

    static JsonElement MesActual(JsonElement d) => d.GetProperty("meses").EnumerateArray().Last();

    [Fact] public async Task Desempeno_cuenta_lo_programado_lo_registrado_sin_conexion_y_lo_confirmado_del_mes()
    {
        var antes = MesActual(await F.Tutor("tutor2").GetFromJsonAsync<JsonElement>("/api/v1/tutores/me/desempeno?meses=3"));
        // Plan del mes actual del tutor 2 con 3 semanas: 1 registrada sin señal y confirmada, 1 registrada en línea, 1 programada
        await F.SuperExec(@"
          do $$ declare pid bigint; h1 bigint; h2 bigint; s1 bigint; s2 bigint; e bigint; mes text := to_char(now() at time zone 'America/Bogota','YYYY-MM'); part bigint;
          begin
            select id into e from estrategias.estrategia order by id limit 1;
            select id into part from seguridad.participante where keycloak_sub='tutor2';
            insert into acompanamiento.plan (public_id,tutor_id,estrategia_id,mes,modalidad,temas) values (gen_random_uuid(),2,e,mes,'INDIVIDUAL','t') returning id into pid;
            insert into acompanamiento.hito_semanal (public_id,plan_id,numero_semana,semana_iso,fecha_inicio,fecha_fin,estado) values
              (gen_random_uuid(),pid,1,'2026-W01',current_date-10,current_date-4,'CONFIRMADO') returning id into h1;
            insert into acompanamiento.hito_semanal (public_id,plan_id,numero_semana,semana_iso,fecha_inicio,fecha_fin,estado) values
              (gen_random_uuid(),pid,2,'2026-W02',current_date-3,current_date+3,'REGISTRADA') returning id into h2;
            insert into acompanamiento.hito_semanal (public_id,plan_id,numero_semana,semana_iso,fecha_inicio,fecha_fin,estado) values
              (gen_random_uuid(),pid,3,'2026-W03',current_date+4,current_date+10,'PROGRAMADA');
            insert into acompanamiento.seguimiento_semanal (public_id,hito_id,actividades,avances,origen,capturado_en,registrado_por)
              values (gen_random_uuid(),h1,'a','b','SIN_CONEXION',now() - interval '5 days',part) returning id into s1;
            insert into acompanamiento.seguimiento_semanal (public_id,hito_id,actividades,avances,origen,capturado_en,registrado_por)
              values (gen_random_uuid(),h2,'a','b','EN_LINEA',now(),part) returning id into s2;
            insert into acompanamiento.asistencia_seguimiento values (s1, 4, true), (s2, 4, false);
          end $$;");
        var d = await F.Tutor("tutor2").GetFromJsonAsync<JsonElement>("/api/v1/tutores/me/desempeno?meses=3");
        var ahora = MesActual(d);
        Assert.Equal(3, d.GetProperty("meses").GetArrayLength());
        Assert.Equal(antes.GetProperty("programadas").GetInt32() + 3, ahora.GetProperty("programadas").GetInt32());
        Assert.Equal(antes.GetProperty("registradas").GetInt32() + 2, ahora.GetProperty("registradas").GetInt32());
        Assert.Equal(antes.GetProperty("sinConexion").GetInt32() + 1, ahora.GetProperty("sinConexion").GetInt32());
        Assert.Equal(antes.GetProperty("enLinea").GetInt32() + 1, ahora.GetProperty("enLinea").GetInt32());
        Assert.Equal(antes.GetProperty("confirmadas").GetInt32() + 1, ahora.GetProperty("confirmadas").GetInt32());
        Assert.True(ahora.GetProperty("docentesAtendidos").GetInt32() >= 1);
        Assert.True(await F.Super<long>("select count(*) from auditoria.bitacora where accion='CONSULTAR_DESEMPENO' and usuario='tutor2@test.co'") > 0);
    }

    [Fact] public async Task Desempeno_es_solo_del_tutor_lider()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await F.Gestor().GetAsync("/api/v1/tutores/me/desempeno")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await F.Gestor().PostAsJsonAsync("/api/v1/tutores/me/informe-mensual", new { mes = "2026-10" })).StatusCode);
    }

    [Fact] public async Task Informe_mensual_genera_PDF_con_codigo_verificable_y_solo_lo_descarga_su_autor()
    {
        var e = await Escenario.Crear(F);
        Assert.Equal(HttpStatusCode.OK, (await F.Tutor().SendAsync(Escenario.Put(e.Hitos[0], e.Cuerpo(), e.Versiones[0]))).StatusCode);

        var r = await F.Tutor().PostAsJsonAsync("/api/v1/tutores/me/informe-mensual", new { mes = e.Mes });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var inf = await r.Content.ReadFromJsonAsync<JsonElement>();
        var codigo = inf.GetProperty("codigo").GetString()!;
        Assert.Matches("^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$", codigo);
        Assert.Equal(64, inf.GetProperty("huella").GetString()!.Length);

        var pdf = await F.Tutor().GetAsync(inf.GetProperty("descarga").GetString());
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync())[..4]));
        Assert.Equal(HttpStatusCode.NotFound, (await F.Tutor("tutor2").GetAsync(inf.GetProperty("descarga").GetString())).StatusCode);

        // La verificación pública reconoce el informe (misma función que los reportes de ley)
        var v = await F.Factory.CreateClient().GetFromJsonAsync<JsonElement>($"/api/v1/reportes-ley/verificar/{codigo}");
        Assert.True(v.GetProperty("valido").GetBoolean());
        Assert.Equal("Informe mensual del acompañamiento", v.GetProperty("plantilla").GetString());
        Assert.Equal(e.Mes, v.GetProperty("periodo").GetString());
    }

    [Fact] public async Task Informe_de_un_mes_sin_plan_da_422_y_mes_invalido_da_400()
    {
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await F.Tutor("tutor2").PostAsJsonAsync("/api/v1/tutores/me/informe-mensual", new { mes = "2030-01" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await F.Tutor().PostAsJsonAsync("/api/v1/tutores/me/informe-mensual", new { mes = "2030-13" })).StatusCode);
    }
}
