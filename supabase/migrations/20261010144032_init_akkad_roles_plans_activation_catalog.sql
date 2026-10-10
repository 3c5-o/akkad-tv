
create extension if not exists pgcrypto;
create table if not exists public.akkad_admins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'admin' check(role in ('admin','super_admin')),
 created_at timestamptz not null default now()
);
create or replace function public.akkad_is_admin() returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.akkad_admins where user_id=auth.uid());
$$;
revoke all on function public.akkad_is_admin() from public;
grant execute on function public.akkad_is_admin() to authenticated;

create table if not exists public.akkad_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'مستخدم أكّد',
 created_at timestamptz not null default now()
);
create table if not exists public.akkad_plans(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 duration_days integer not null check(duration_days between 1 and 3660),
 max_devices integer not null default 1 check(max_devices between 1 and 20),
 max_connections integer not null default 1 check(max_connections between 1 and 20),
 kind text not null default 'hybrid' check(kind in ('private','general','hybrid')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.akkad_subscriptions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_id uuid references public.akkad_plans(id) on delete set null,
 starts_at timestamptz not null default now(),
 ends_at timestamptz not null,
 status text not null default 'active' check(status in ('active','paused','cancelled')),
 created_at timestamptz not null default now(),
 check(ends_at > starts_at)
);
create index if not exists akkad_subscriptions_user_expiry on public.akkad_subscriptions(user_id,ends_at desc);

create table if not exists public.akkad_activations(
 id uuid primary key default gen_random_uuid(),
 code_hash text unique not null check(length(code_hash)=64),
 plan_id uuid not null references public.akkad_plans(id),
 note text not null default '',
 used_by uuid references auth.users(id) on delete set null,
 used_at timestamptz,
 expires_at timestamptz,
 disabled boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.akkad_sources(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 kind text not null check(kind in ('xtream','m3u','direct','hls')),
 endpoint text not null,
 credential_ref text,
 license_confirmed boolean not null default false,
 enabled boolean not null default false,
 last_checked_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.akkad_catalog(
 id uuid primary key default gen_random_uuid(),
 source_id uuid references public.akkad_sources(id) on delete set null,
 title text not null,
 kind text not null check(kind in ('live','movie','series','anime')),
 category text not null default 'عام',
 description text not null default '',
 poster_url text,
 tmdb_id bigint,
 release_year integer,
 published boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists akkad_catalog_kind_published on public.akkad_catalog(kind,published,created_at desc);

create table if not exists public.akkad_streams(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.akkad_catalog(id) on delete cascade,
 label text not null default 'تلقائي',
 media_url text not null,
 media_type text not null default 'hls' check(media_type in ('hls','dash','mp4','ts','mkv','other')),
 priority integer not null default 100,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.akkad_devices(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 device_hash text not null,
 device_label text not null default 'جهاز',
 last_seen_at timestamptz not null default now(),
 blocked boolean not null default false,
 unique(user_id,device_hash)
);
create table if not exists public.akkad_audit(
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 info jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

alter table public.akkad_admins enable row level security;
alter table public.akkad_profiles enable row level security;
alter table public.akkad_plans enable row level security;
alter table public.akkad_subscriptions enable row level security;
alter table public.akkad_activations enable row level security;
alter table public.akkad_sources enable row level security;
alter table public.akkad_catalog enable row level security;
alter table public.akkad_streams enable row level security;
alter table public.akkad_devices enable row level security;
alter table public.akkad_audit enable row level security;

create policy "admin self read" on public.akkad_admins for select to authenticated using (user_id=auth.uid());
create policy "profiles self and admin read" on public.akkad_profiles for select to authenticated using(user_id=auth.uid() or public.akkad_is_admin());
create policy "profiles self update" on public.akkad_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "profiles self insert" on public.akkad_profiles for insert to authenticated with check(user_id=auth.uid());
create policy "plans public active" on public.akkad_plans for select to anon,authenticated using(active or public.akkad_is_admin());
create policy "plans admin insert" on public.akkad_plans for insert to authenticated with check(public.akkad_is_admin());
create policy "plans admin update" on public.akkad_plans for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "plans admin delete" on public.akkad_plans for delete to authenticated using(public.akkad_is_admin());
create policy "subs self and admin read" on public.akkad_subscriptions for select to authenticated using(user_id=auth.uid() or public.akkad_is_admin());
create policy "subs admin insert" on public.akkad_subscriptions for insert to authenticated with check(public.akkad_is_admin());
create policy "subs admin update" on public.akkad_subscriptions for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "activation admin read" on public.akkad_activations for select to authenticated using(public.akkad_is_admin());
create policy "activation admin insert" on public.akkad_activations for insert to authenticated with check(public.akkad_is_admin());
create policy "activation admin update" on public.akkad_activations for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "sources admin read" on public.akkad_sources for select to authenticated using(public.akkad_is_admin());
create policy "sources admin insert" on public.akkad_sources for insert to authenticated with check(public.akkad_is_admin());
create policy "sources admin update" on public.akkad_sources for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "catalog public published" on public.akkad_catalog for select to anon,authenticated using(published or public.akkad_is_admin());
create policy "catalog admin insert" on public.akkad_catalog for insert to authenticated with check(public.akkad_is_admin());
create policy "catalog admin update" on public.akkad_catalog for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "catalog admin delete" on public.akkad_catalog for delete to authenticated using(public.akkad_is_admin());
create policy "streams admin read" on public.akkad_streams for select to authenticated using(public.akkad_is_admin());
create policy "streams admin insert" on public.akkad_streams for insert to authenticated with check(public.akkad_is_admin());
create policy "streams admin update" on public.akkad_streams for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "devices self/admin read" on public.akkad_devices for select to authenticated using(user_id=auth.uid() or public.akkad_is_admin());
create policy "devices self insert" on public.akkad_devices for insert to authenticated with check(user_id=auth.uid() and not blocked);
create policy "devices admin update" on public.akkad_devices for update to authenticated using(public.akkad_is_admin()) with check(public.akkad_is_admin());
create policy "audit admin read" on public.akkad_audit for select to authenticated using(public.akkad_is_admin());
create policy "audit admin insert" on public.akkad_audit for insert to authenticated with check(public.akkad_is_admin());

create or replace function public.akkad_redeem(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_act public.akkad_activations%rowtype; v_days integer; v_sub uuid;
begin
 v_user := auth.uid();
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_code !~ '^[A-Za-z0-9-]{12,80}$' then raise exception 'Invalid activation code'; end if;
 select * into v_act from public.akkad_activations
 where code_hash = encode(digest(upper(trim(p_code)),'sha256'),'hex') for update;
 if not found or v_act.used_by is not null or v_act.disabled or (v_act.expires_at is not null and v_act.expires_at < now())
 then raise exception 'Activation code is unavailable'; end if;
 select duration_days into v_days from public.akkad_plans where id=v_act.plan_id and active;
 if v_days is null then raise exception 'Plan unavailable'; end if;
 insert into public.akkad_subscriptions(user_id,plan_id,ends_at)
 values(v_user,v_act.plan_id,now()+make_interval(days=>v_days)) returning id into v_sub;
 update public.akkad_activations set used_by=v_user,used_at=now() where id=v_act.id;
 return jsonb_build_object('ok',true,'subscription_id',v_sub,'duration_days',v_days);
end $$;
revoke all on function public.akkad_redeem(text) from public;
grant execute on function public.akkad_redeem(text) to authenticated;

create or replace function public.akkad_get_playback(p_item uuid)
returns table(label text,media_url text,media_type text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.akkad_is_admin() and not exists(
   select 1 from public.akkad_subscriptions s where s.user_id=auth.uid()
   and s.status='active' and s.starts_at<=now() and s.ends_at>now()
 ) then raise exception 'Active subscription required'; end if;
 return query select t.label,t.media_url,t.media_type
 from public.akkad_streams t join public.akkad_catalog c on c.id=t.item_id
 where c.id=p_item and t.enabled and (c.published or public.akkad_is_admin())
 order by t.priority asc limit 12;
end $$;
revoke all on function public.akkad_get_playback(uuid) from public;
grant execute on function public.akkad_get_playback(uuid) to authenticated;

insert into public.akkad_admins(user_id,role)
select id,'super_admin' from auth.users where lower(email)='akkadtv10@gmail.com'
and email_confirmed_at is not null
on conflict(user_id) do update set role=excluded.role;
insert into public.akkad_profiles(user_id,display_name)
select id,'مدير أكّد' from auth.users where lower(email)='akkadtv10@gmail.com'
on conflict(user_id) do nothing;
insert into public.akkad_plans(name,duration_days,max_devices,max_connections,kind)
select p.name,p.days,1,1,'hybrid' from
(values ('شهر',30),('ثلاثة أشهر',90),('ستة أشهر',180),('سنة',365)) as p(name,days)
where not exists(select 1 from public.akkad_plans);
