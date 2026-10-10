
create extension if not exists pgcrypto;
alter table public.akkad_sources
 add column if not exists free_code text,
 add column if not exists free_enabled boolean not null default false,
 add column if not exists auto_import boolean not null default false,
 add column if not exists auto_publish boolean not null default false,
 add column if not exists auto_interval_minutes integer not null default 60,
 add column if not exists auto_last_run_at timestamptz,
 add column if not exists auto_last_error text;
alter table public.akkad_sources
 add constraint akkad_free_code_format check(free_code is null or free_code ~ '^[A-Z0-9]{2,12}$');
alter table public.akkad_sources
 add constraint akkad_auto_interval_range check(auto_interval_minutes between 30 and 10080);
create unique index if not exists akkad_free_code_unique on public.akkad_sources(upper(free_code)) where free_code is not null;
create table if not exists public.akkad_viewer_accounts(
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null,
 display_name text not null default '',
 active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint akkad_username_format check(username ~ '^[a-zA-Z0-9_]{3,32}$')
);
create unique index if not exists akkad_viewer_username_unique on public.akkad_viewer_accounts(lower(username));
alter table public.akkad_viewer_accounts enable row level security;
create policy "viewer self" on public.akkad_viewer_accounts for select to authenticated using(user_id=auth.uid());
create policy "viewer admin read" on public.akkad_viewer_accounts for select to authenticated using(public.akkad_is_admin());
create policy "viewer admin update" on public.akkad_viewer_accounts for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "viewer admin insert" on public.akkad_viewer_accounts for insert to authenticated with check(public.akkad_is_admin());
create table if not exists public.akkad_config(
 setting_key text primary key,
 ciphertext text not null,
 iv text not null,
 tag text not null,
 updated_at timestamptz not null default now()
);
alter table public.akkad_config enable row level security;
create policy "config superadmin read" on public.akkad_config for select to authenticated using(
 exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin')
);
create policy "config superadmin write" on public.akkad_config for insert to authenticated with check(
 exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin')
);
create policy "config superadmin update" on public.akkad_config for update to authenticated using(
 exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin')
) with check(
 exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin')
);
create index if not exists akkad_sources_auto_idx on public.akkad_sources(auto_import,enabled);
