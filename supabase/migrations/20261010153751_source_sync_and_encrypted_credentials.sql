
alter table public.akkad_sources
 add column if not exists last_check_status text not null default 'never',
 add column if not exists last_error text,
 add column if not exists last_synced_at timestamptz,
 add column if not exists live_count integer not null default 0,
 add column if not exists movie_count integer not null default 0,
 add column if not exists series_count integer not null default 0,
 add column if not exists provider_expires_at timestamptz,
 add column if not exists provider_max_connections integer,
 add column if not exists provider_active_connections integer;

alter table public.akkad_catalog
 add column if not exists dedupe_key text unique,
 add column if not exists last_synced_at timestamptz;

create table if not exists public.akkad_source_credentials(
 source_id uuid primary key references public.akkad_sources(id) on delete cascade,
 ciphertext text not null,
 iv text not null,
 tag text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.akkad_source_items(
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references public.akkad_sources(id) on delete cascade,
 catalog_id uuid not null references public.akkad_catalog(id) on delete cascade,
 kind text not null check(kind in ('live','movie','series')),
 external_id text not null,
 category text not null default 'عام',
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 unique(source_id,kind,external_id)
);
create index if not exists akkad_source_items_catalog_id_idx on public.akkad_source_items(catalog_id);
create table if not exists public.akkad_source_sync_jobs(
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references public.akkad_sources(id) on delete cascade,
 kind text not null check(kind in ('live','movie','series')),
 status text not null default 'running' check(status in ('running','success','failed')),
 requested_limit integer not null check(requested_limit between 1 and 100),
 imported_count integer not null default 0,
 skipped_count integer not null default 0,
 error_summary text,
 started_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists akkad_sync_jobs_source_time_idx on public.akkad_source_sync_jobs(source_id,started_at desc);

alter table public.akkad_source_credentials enable row level security;
alter table public.akkad_source_items enable row level security;
alter table public.akkad_source_sync_jobs enable row level security;

create policy "credentials admin read" on public.akkad_source_credentials
for select to authenticated using(public.akkad_is_admin());
create policy "credentials admin insert" on public.akkad_source_credentials
for insert to authenticated with check(public.akkad_is_admin());
create policy "credentials admin update" on public.akkad_source_credentials
for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "source items admin read" on public.akkad_source_items
for select to authenticated using(public.akkad_is_admin());
create policy "source items admin insert" on public.akkad_source_items
for insert to authenticated with check(public.akkad_is_admin());
create policy "source items admin update" on public.akkad_source_items
for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "sync jobs admin read" on public.akkad_source_sync_jobs
for select to authenticated using(public.akkad_is_admin());
create policy "sync jobs admin insert" on public.akkad_source_sync_jobs
for insert to authenticated with check(public.akkad_is_admin());
create policy "sync jobs admin update" on public.akkad_source_sync_jobs
for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());

create or replace function public.akkad_source_counts(p_source uuid)
returns table(live integer,movie integer,series integer)
language sql stable security definer
set search_path='' as $$
 select
 count(*) filter(where kind='live')::integer,
 count(*) filter(where kind='movie')::integer,
 count(*) filter(where kind='series')::integer
 from public.akkad_source_items where source_id=p_source
 and public.akkad_is_admin()
$$;
revoke all on function public.akkad_source_counts(uuid) from public;
grant execute on function public.akkad_source_counts(uuid) to authenticated;
