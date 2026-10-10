alter table public.akkad_sources
 add column if not exists allow_insecure_http boolean not null default false;
comment on column public.akkad_sources.allow_insecure_http is 'Explicit administrator consent for plaintext HTTP provider connections. Requires AKKAD_ALLOW_HTTP_SOURCES=true and a matching allowlisted public host.';
