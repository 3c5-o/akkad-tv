
-- Scoped catalog for a free source; no provider credentials are ever returned.
create or replace function public.akkad_free_catalog(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source_uuid uuid; source_title text; output jsonb;
begin
  if p_code is null or p_code !~ '^[A-Z0-9]{2,12}$' then
    return jsonb_build_object('source',null,'items','[]'::jsonb);
  end if;
  select s.id,s.name into source_uuid,source_title
    from public.akkad_sources s
   where s.free_code=p_code and s.free_enabled and s.enabled
     and s.license_confirmed and s.last_check_status='ok'
     and (s.provider_expires_at is null or s.provider_expires_at>now())
   limit 1;
  if source_uuid is null then
    return jsonb_build_object('source',null,'items','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into output from (
    select distinct on (c.id) c.id,c.title,c.kind,c.category,c.description,c.poster_url,c.release_year
      from public.akkad_source_items si
      join public.akkad_catalog c on c.id=si.catalog_id
     where si.source_id=source_uuid
     order by c.id,c.created_at desc limit 1000
  ) v;
  return jsonb_build_object('source',jsonb_build_object('name',source_title,'code',p_code),
         'items',output);
end $$;
revoke all on function public.akkad_free_catalog(text) from public;
grant execute on function public.akkad_free_catalog(text) to anon, authenticated;

create or replace function public.akkad_free_item(p_code text,p_item uuid)
returns table(source_id uuid,kind text,external_id text,media_id uuid)
language sql stable security definer set search_path='' as $$
  select si.source_id,si.kind,si.external_id,c.id
    from public.akkad_sources s
    join public.akkad_source_items si on si.source_id=s.id
    join public.akkad_catalog c on c.id=si.catalog_id
   where s.free_code=p_code and s.free_enabled and s.enabled
     and s.license_confirmed and s.last_check_status='ok'
     and (s.provider_expires_at is null or s.provider_expires_at>now())
     and c.id=p_item
   limit 1;
$$;
revoke all on function public.akkad_free_item(text,uuid) from public;
grant execute on function public.akkad_free_item(text,uuid) to anon,authenticated;

-- Admin dashboard list with subscription status and duration, without exposing login credentials.
create or replace function public.akkad_admin_list_viewers(p_search text default '',
 p_offset integer default 0,p_limit integer default 50)
returns table(user_id uuid,username text,display_name text,active boolean,
 created_at timestamptz,subscription_id uuid,subscription_status text,
 ends_at timestamptz,starts_at timestamptz,remaining_days integer,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.akkad_is_admin() then raise exception 'ADMIN_ONLY'; end if;
 return query
 select v.user_id,v.username,v.display_name,v.active,v.created_at,
        sub.id,sub.status,sub.ends_at,sub.starts_at,
        case when sub.ends_at>now() and sub.status='active' then ceil(extract(epoch from(sub.ends_at-now()))/86400)::integer else 0 end,
        count(*) over()
 from public.akkad_viewer_accounts v
 left join lateral (
   select s.id,s.status,s.ends_at,s.starts_at
   from public.akkad_subscriptions s where s.user_id=v.user_id
   order by case when s.status='active' and s.ends_at>now() then 0 else 1 end,
      s.ends_at desc limit 1
 ) sub on true
 where coalesce(p_search,'')='' or v.username ilike '%'||replace(replace(p_search,'%','\%'),'_','\_')||'%' escape '\'
 order by v.created_at desc
 limit greatest(1,least(coalesce(p_limit,50),100))
 offset greatest(0,coalesce(p_offset,0));
end $$;
revoke all on function public.akkad_admin_list_viewers(text,integer,integer) from public;
grant execute on function public.akkad_admin_list_viewers(text,integer,integer) to authenticated;

-- Extends the latest valid expiry atomically. No code needed.
create or replace function public.akkad_admin_activate_viewer(p_user uuid,p_days integer,p_plan uuid default null)
returns table(subscription_id uuid,activated_from timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare current_end timestamptz; new_end timestamptz; new_id uuid;
begin
 if not exists(select 1 from public.akkad_admins where user_id=auth.uid() and role='super_admin') then
   raise exception 'SUPER_ADMIN_ONLY';
 end if;
 if p_days is null or p_days<1 or p_days>1095 then raise exception 'DURATION_OUT_OF_RANGE'; end if;
 if not exists(select 1 from public.akkad_viewer_accounts where user_id=p_user) then
   raise exception 'VIEWER_NOT_FOUND';
 end if;
 if p_plan is not null and not exists(select 1 from public.akkad_plans where id=p_plan and active) then
   raise exception 'PLAN_NOT_FOUND';
 end if;
 perform 1 from public.akkad_viewer_accounts where user_id=p_user for update;
 select max(s.ends_at) into current_end from public.akkad_subscriptions s
  where s.user_id=p_user and s.status='active' and s.ends_at>now();
 new_end:=greatest(now(),coalesce(current_end,now()))+(p_days||' days')::interval;
 insert into public.akkad_subscriptions(user_id,plan_id,starts_at,ends_at,status)
 values(p_user,p_plan,now(),new_end,'active') returning id into new_id;
 return query select new_id,now(),new_end;
end $$;
revoke all on function public.akkad_admin_activate_viewer(uuid,integer,uuid) from public;
grant execute on function public.akkad_admin_activate_viewer(uuid,integer,uuid) to authenticated;

create or replace function public.akkad_admin_suspend_viewer(p_user uuid,p_suspend boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.akkad_admins where user_id=auth.uid() and role='super_admin') then
   raise exception 'SUPER_ADMIN_ONLY';
 end if;
 update public.akkad_viewer_accounts set active=not p_suspend where user_id=p_user;
 if not found then raise exception 'VIEWER_NOT_FOUND'; end if;
 if p_suspend then
   update public.akkad_subscriptions set status='paused'
   where user_id=p_user and status='active';
 end if;
 return true;
end $$;
revoke all on function public.akkad_admin_suspend_viewer(uuid,boolean) from public;
grant execute on function public.akkad_admin_suspend_viewer(uuid,boolean) to authenticated;
