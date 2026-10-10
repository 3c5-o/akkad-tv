create policy "sources superadmin delete" on public.akkad_sources
for delete to authenticated using(
 exists(select 1 from public.akkad_admins a where a.user_id=auth.uid() and a.role='super_admin')
);