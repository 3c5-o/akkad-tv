
drop policy if exists "catalog public published" on public.akkad_catalog;
create policy "catalog authenticated active viewers and admins" on public.akkad_catalog
 for select to authenticated using(
 public.akkad_is_admin() or
 (published=true and exists(
  select 1 from public.akkad_viewer_accounts v
  where v.user_id=auth.uid() and v.active=true
 ))
);
create or replace function public.akkad_get_playback(p_item uuid)
returns table(label text,media_url text,media_type text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.akkad_is_admin() and not exists(
  select 1 from public.akkad_viewer_accounts v where v.user_id=auth.uid() and v.active=true
 ) then raise exception 'Active managed viewer required'; end if;
 if not public.akkad_is_admin() and not exists(
   select 1 from public.akkad_subscriptions s where s.user_id=auth.uid()
   and s.status='active' and s.starts_at<=now() and s.ends_at>now()
 ) then raise exception 'Active subscription required'; end if;
 return query select t.label,t.media_url,t.media_type from public.akkad_streams t
 join public.akkad_catalog c on c.id=t.item_id
 where c.id=p_item and t.enabled and (c.published or public.akkad_is_admin())
 order by t.priority asc limit 12;
end $$;
revoke all on function public.akkad_get_playback(uuid) from public;
grant execute on function public.akkad_get_playback(uuid) to authenticated;
