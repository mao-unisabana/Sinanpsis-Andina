-- D42: historial sintético del Tutor Líder demo (tutor 1, Andrés) en los 5 meses anteriores al actual, para "Mi desempeño"
-- y el informe mensual. No toca el mes actual (es el que se reinicia en cada ensayo de la demo).
-- Idempotente: si el tutor 1 ya tiene planes de meses anteriores no hace nada. Determinista (setseed).
do $$
declare
  pid bigint; hid bigint; sid bigint; r record; m int; w int; mes_d date; ini date; fi date; ff date;
  estado text; cap timestamptz; reg timestamptz; participante bigint; p numeric; origen text; doc bigint; i int;
  actividades text[] := array['Taller de planeación de clases con los docentes','Observación de aula y retroalimentación','Círculo de lectura pedagógica','Revisión de evidencias de aprendizaje','Diseño de evaluación formativa','Acompañamiento en el uso de guías de la estrategia'];
begin
  if exists (select 1 from acompanamiento.plan where tutor_id = 1 and mes < to_char(now() at time zone 'America/Bogota', 'YYYY-MM')) then
    raise notice 'Historial del tutor demo ya sembrado'; return;
  end if;
  perform setseed(0.42);
  select id into participante from seguridad.participante where rol = 'TUTOR_LIDER' and persona_id = 1;
  for m in reverse 5..1 loop
    mes_d := (date_trunc('month', now() at time zone 'America/Bogota') - make_interval(months => m))::date;
    p := 0.62 + (5 - m) * 0.07;            -- el cumplimiento mejora mes a mes (62 % → 90 %)
    for r in select a.estrategia_id, array_agg(a.docente_id order by a.docente_id) docs
             from acompanamiento.asignacion a where a.tutor_id = 1 and a.vigente group by a.estrategia_id loop
      insert into acompanamiento.plan (public_id, tutor_id, estrategia_id, mes, modalidad, temas)
        values (gen_random_uuid(), 1, r.estrategia_id, to_char(mes_d, 'YYYY-MM'), 'GRUPAL', 'Planeación de clases, evaluación formativa y lectura en voz alta')
        returning id into pid;
      insert into acompanamiento.plan_docente select pid, unnest(r.docs), 1, to_char(mes_d, 'YYYY-MM') on conflict do nothing;
      ini := mes_d + ((8 - extract(isodow from mes_d)::int) % 7);  -- primer lunes del mes
      for w in 1..4 loop
        fi := ini + 7 * (w - 1); ff := fi + 6;
        if random() < p then
          estado := case when random() < 0.70 then 'CONFIRMADO' when random() < 0.20 then 'OBSERVADO' else 'REGISTRADA' end;
        else estado := 'PROGRAMADA'; end if;
        insert into acompanamiento.hito_semanal (public_id, plan_id, numero_semana, semana_iso, fecha_inicio, fecha_fin, estado)
          values (gen_random_uuid(), pid, w, to_char(fi, 'IYYY-"W"IW'), fi, ff, estado) returning id into hid;
        if estado <> 'PROGRAMADA' then
          -- Tumaco: cerca del 40 % se captura en vereda sin señal y se sincroniza días después
          origen := case when random() < 0.4 then 'SIN_CONEXION' else 'EN_LINEA' end;
          -- casi siempre se registra la misma semana; a veces (≈15 %) tarde, días después
          cap := (case when random() < 0.85 then ff - (random() * 2)::int else ff + 3 + (random() * 4)::int end)::timestamptz + interval '15 hours';
          reg := case when origen = 'SIN_CONEXION' then cap + make_interval(days => 1 + (random() * 3)::int, hours => 2) else cap + interval '5 minutes' end;
          insert into acompanamiento.seguimiento_semanal (public_id, hito_id, actividades, avances, origen, capturado_en, registrado_en, registrado_por)
            values (gen_random_uuid(), hid, actividades[1 + (random() * 5)::int], 'Los docentes aplicaron lo trabajado en el aula y compartieron evidencias.', origen, cap, reg, participante)
            returning id into sid;
          insert into acompanamiento.asistencia_seguimiento select sid, x, random() < 0.88 from unnest(r.docs) x;
          if estado in ('CONFIRMADO', 'OBSERVADO') then
            i := 0;
            foreach doc in array r.docs loop
              i := i + 1;
              insert into acompanamiento.confirmacion_docente (public_id, hito_id, docente_id, confirmado, observacion, origen, capturado_en)
                values (gen_random_uuid(), hid, doc, not (estado = 'OBSERVADO' and i = 1),
                        case when estado = 'OBSERVADO' and i = 1 then 'El encuentro fue más corto de lo registrado.' end,
                        case when random() < 0.3 then 'SIN_CONEXION' else 'EN_LINEA' end, reg + interval '1 day')
                on conflict do nothing;
            end loop;
          end if;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
select analitica.refrescar();
