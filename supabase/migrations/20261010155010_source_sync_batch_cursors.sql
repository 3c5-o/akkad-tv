
alter table public.akkad_source_sync_jobs
 add column if not exists requested_offset integer not null default 0 check(requested_offset >= 0),
 add column if not exists next_offset integer not null default 0 check(next_offset >= 0),
 add column if not exists available_count integer not null default 0 check(available_count >= 0);
