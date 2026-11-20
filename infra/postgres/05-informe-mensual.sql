\c sses sses_owner
-- D41: informe mensual del Tutor Líder (PDF con código de verificación y huella SHA-256), separado de reportes.emision:
-- no pertenece a un ente de control (sin organizacion_id ni RLS por organización); la API lo filtra por participante.
-- Idempotente: corre al primer arranque y desde scripts/reset-demo.sh sobre bases existentes (D32).
create table if not exists reportes.informe_mensual (
  id bigint generated always as identity primary key,
  public_id uuid not null unique,
  participante_id bigint not null references seguridad.participante(id),
  mes char(7) not null,
  codigo_verificacion text not null unique,
  huella_contenido char(64) not null,
  huella_archivo char(64) not null,
  filas int not null,
  pdf bytea not null,
  emitido_en timestamptz not null default now());
create index if not exists ix_informe_mensual_participante on reportes.informe_mensual (participante_id, emitido_en desc);

-- La verificación pública reconoce los dos tipos de documento (misma firma de la función de 04-reportes.sql)
create or replace function reportes.verificar(p_codigo text)
returns table (plantilla text, organizacion text, vigencia int, periodo text, emitida_en timestamptz, filas int, huella_contenido char(64), huella_archivo char(64))
language sql security definer set search_path = reportes, pg_temp as $$
  select p.nombre, o.nombre, e.vigencia, e.periodo, e.emitida_en, e.filas, e.huella_contenido, e.huella_archivo
  from reportes.emision e join reportes.plantilla p on p.id = e.plantilla_id join reportes.organizacion_control o on o.id = e.organizacion_id
  where e.codigo_verificacion = upper(p_codigo)
  union all
  select 'Informe mensual del acompañamiento', 'Tutor Líder: ' || pa.nombre, left(i.mes, 4)::int, i.mes::text, i.emitido_en, i.filas, i.huella_contenido, i.huella_archivo
  from reportes.informe_mensual i join seguridad.participante pa on pa.id = i.participante_id
  where i.codigo_verificacion = upper(p_codigo)
$$;
revoke all on function reportes.verificar(text) from public;
grant execute on function reportes.verificar(text) to sses_api;
grant select, insert on reportes.informe_mensual to sses_api;
