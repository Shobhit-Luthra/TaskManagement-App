-- Bugfix: percentile_cont() returns double precision, but the function
-- declares median_hours/p25_hours/p75_hours as numeric — Postgres refused
-- with 42804 "structure of query does not match function result type" on
-- every call, since RETURNS TABLE columns require an exact type match (no
-- implicit narrowing cast). Fix: cast each percentile expression to numeric.
create or replace function public.analytics_cycle_time(p_project_id uuid, p_weeks integer default 12)
returns table (week_start date, sample_size integer, median_hours numeric, p25_hours numeric, p75_hours numeric)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;

  return query
    with latest_completion as (
      select
        t.id as task_id,
        t.created_at as task_created_at,
        max(a.created_at) as completed_at
      from public.tasks t
      join public.activity a
        on a.task_id = t.id and a.action = 'completed'
      where t.project_id = p_project_id
        and a.created_at > coalesce(
          (select max(r.created_at) from public.activity r
             where r.task_id = t.id and r.action = 'reopened'),
          '-infinity'::timestamptz
        )
      group by t.id, t.created_at
    ),
    cycle as (
      select
        (date_trunc('week', (lc.completed_at at time zone project_timezone)))::date as week_start,
        extract(epoch from (lc.completed_at - lc.task_created_at)) / 3600.0 as cycle_hours
      from latest_completion lc
      where lc.completed_at >= now() - make_interval(weeks => p_weeks)
    )
    select
      c.week_start,
      count(*)::integer as sample_size,
      case when count(*) >= 3 then (percentile_cont(0.5) within group (order by c.cycle_hours))::numeric end as median_hours,
      case when count(*) >= 3 then (percentile_cont(0.25) within group (order by c.cycle_hours))::numeric end as p25_hours,
      case when count(*) >= 3 then (percentile_cont(0.75) within group (order by c.cycle_hours))::numeric end as p75_hours
    from cycle c
    group by c.week_start
    order by c.week_start;
end;
$$;
revoke all on function public.analytics_cycle_time(uuid, integer) from public;
grant execute on function public.analytics_cycle_time(uuid, integer) to authenticated;
