
create or replace function public.akkad_admin_delete_source(p_source uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare owned uuid[];
begin
  if not exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin') then
     raise exception 'SUPER_ADMIN_ONLY';
  end if;
  if not exists(select 1 from public.akkad_sources where id=p_source) then
     raise exception 'SOURCE_NOT_FOUND';
  end if;
  select array_agg(distinct c.id) into owned
    from public.akkad_catalog c join public.akkad_source_items si on si.catalog_id=c.id
   where si.source_id=p_source and c.source_id=p_source;
  delete from public.akkad_sources where id=p_source;
  if owned is not null then
   delete from public.akkad_catalog c
    where c.id=any(owned) and c.source_id is null
      and not exists(select 1 from public.akkad_source_items si where si.catalog_id=c.id);
  end if;
  return true;
end $$;
revoke all on function public.akkad_admin_delete_source(uuid) from public;
grant execute on function public.akkad_admin_delete_source(uuid) to authenticated;
