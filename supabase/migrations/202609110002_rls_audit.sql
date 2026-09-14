create or replace function public.tables_without_rls()
returns table (table_name text) language sql security definer set search_path = public, pg_catalog as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (not c.relrowsecurity or not c.relforcerowsecurity)
  order by 1;
$$;

revoke all on function public.tables_without_rls() from public;
revoke all on function public.tables_without_rls() from authenticated;
grant execute on function public.tables_without_rls() to service_role;
