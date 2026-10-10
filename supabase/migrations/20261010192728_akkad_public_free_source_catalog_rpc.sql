
create or replace function public.akkad_free_catalog(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; src_name text; result jsonb;
begin
 if p_code is null or p_code !~ '^[A-Z0-9]{2,12}$' then
  return jsonb_build_object('source',null,'items','[]'::jsonb);
 end if;
 select s.id,s.name into sid,src_name from public.akkad_sources s
 where s.free_code=p_code and s.free_enabled=true and s.enabled=true
 and s.last_check_status='ok' and s.license_confirmed=true limit 1;
 if sid is null then return jsonb_build_object('source',null,'items','[]'::jsonb); end if;
 select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into result from (
  select c.id,c.title,c.kind,c.category,c.description,c.poster_url,c.release_year
  from public.akkad_catalog c where c.source_id=sid and c.published=true
  order by c.created_at desc limit 200
 ) i;
 return jsonb_build_object('source',jsonb_build_object('name',src_name,'code',p_code),'items',result);
end $$;
revoke all on function public.akkad_free_catalog(text) from public;
grant execute on function public.akkad_free_catalog(text) to anon, authenticated;
