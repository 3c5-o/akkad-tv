
create or replace function public.akkad_member_item(p_item uuid)
returns table(source_id uuid,kind text,external_id text,media_id uuid)
language sql stable security definer set search_path='' as $$
 select si.source_id,si.kind,si.external_id,c.id
   from public.akkad_catalog c
   join public.akkad_source_items si on si.catalog_id=c.id
   join public.akkad_sources src on src.id=si.source_id
  where c.id=p_item and c.published=true
    and src.enabled=true and src.license_confirmed=true
    and src.last_check_status='ok'
    and (src.provider_expires_at is null or src.provider_expires_at>now())
    and auth.uid() is not null
    and (
       public.akkad_is_admin()
       or (
        exists(select 1 from public.akkad_viewer_accounts v
          where v.user_id=auth.uid() and v.active=true)
        and exists(select 1 from public.akkad_subscriptions s
          where s.user_id=auth.uid() and s.status='active'
            and s.starts_at<=now() and s.ends_at>now())
       )
    )
 order by si.last_seen_at desc
 limit 1;
$$;
revoke all on function public.akkad_member_item(uuid) from public;
grant execute on function public.akkad_member_item(uuid) to authenticated;
