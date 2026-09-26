-- Analytics is admin-only (design 2026-09-26). Each analytics RPC is
-- re-created from its latest definition (cycle time from 202609250005, the
-- rest from 202609250004) with one change: the membership gate becomes
-- is_project_admin(). Non-admins get the same P0002 as non-members, so they
-- cannot tell the analytics endpoints apart from a missing project.
-- Completed tasks per ISO week, project-timezone-aware bucketing (G3).
create or replace function public.analytics_throughput(p_project_id uuid, p_weeks integer default 12)
returns table (week_start date, completed_count integer)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;

  return query
    select
      (date_trunc('week', (a.created_at at time zone project_timezone)))::date as week_start,
      count(*)::integer as completed_count
    from public.activity a
    where a.project_id = p_project_id
      and a.action = 'completed'
      and a.created_at >= now() - make_interval(weeks => p_weeks)
    group by 1
    order by 1;
end;
$$;
revoke all on function public.analytics_throughput(uuid, integer) from public, anon;
grant execute on function public.analytics_throughput(uuid, integer) to authenticated;

create or replace function public.analytics_cycle_time(p_project_id uuid, p_weeks integer default 12)
returns table (week_start date, sample_size integer, median_hours numeric, p25_hours numeric, p75_hours numeric)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
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
revoke all on function public.analytics_cycle_time(uuid, integer) from public, anon;
grant execute on function public.analytics_cycle_time(uuid, integer) to authenticated;

-- Reads board_snapshots directly — a day with no snapshot row simply has no
-- row here, so the client renders a visible gap rather than an interpolated
-- guess (never fabricate data across a missed cron run).
create or replace function public.analytics_cumulative_flow(p_project_id uuid, p_days integer default 30)
returns table (snapshot_date date, column_id uuid, column_name varchar, task_count integer)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    select bs.snapshot_date, bs.column_id, c.name, bs.task_count
    from public.board_snapshots bs
    join public.columns c on c.id = bs.column_id
    where bs.project_id = p_project_id
      and bs.snapshot_date >= current_date - p_days
    order by bs.snapshot_date, c.position;
end;
$$;
revoke all on function public.analytics_cumulative_flow(uuid, integer) from public, anon;
grant execute on function public.analytics_cumulative_flow(uuid, integer) to authenticated;

-- Open vs done task counts per current member (G4: evaluated against
-- CURRENT column flags, never a historical reconstruction).
create or replace function public.analytics_workload(p_project_id uuid)
returns table (member_user_id uuid, display_name varchar, open_count integer, done_count integer)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    select
      m.user_id as member_user_id,
      u.display_name,
      count(*) filter (where not c.is_done_column)::integer as open_count,
      count(*) filter (where c.is_done_column)::integer as done_count
    from public.memberships m
    join public.users u on u.id = m.user_id
    left join public.tasks t on t.assignee_id = m.user_id and t.project_id = p_project_id and t.deleted_at is null
    left join public.columns c on c.id = t.column_id
    where m.project_id = p_project_id
    group by m.user_id, u.display_name
    order by u.display_name;
end;
$$;
revoke all on function public.analytics_workload(uuid) from public, anon;
grant execute on function public.analytics_workload(uuid) to authenticated;

-- Overdue is evaluated in the PROJECT's timezone (G3) — two teammates in
-- different timezones must agree on what counts as overdue on the shared board.
create or replace function public.analytics_summary(p_project_id uuid)
returns table (total_open integer, total_done integer, overdue_count integer, avg_cycle_hours numeric)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
  today_in_project date;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;
  today_in_project := (now() at time zone project_timezone)::date;

  return query
    with counts as (
      select
        count(*) filter (where not c.is_done_column)::integer as total_open,
        count(*) filter (where c.is_done_column)::integer as total_done,
        count(*) filter (where not c.is_done_column and t.due_date is not null and t.due_date < today_in_project)::integer as overdue_count
      from public.tasks t
      join public.columns c on c.id = t.column_id
      where t.project_id = p_project_id and t.deleted_at is null
    ),
    latest_completion as (
      select t.id as task_id, t.created_at as task_created_at, max(a.created_at) as completed_at
      from public.tasks t
      join public.activity a on a.task_id = t.id and a.action = 'completed'
      where t.project_id = p_project_id
        and a.created_at > coalesce(
          (select max(r.created_at) from public.activity r where r.task_id = t.id and r.action = 'reopened'),
          '-infinity'::timestamptz
        )
      group by t.id, t.created_at
    )
    select
      counts.total_open,
      counts.total_done,
      counts.overdue_count,
      (select avg(extract(epoch from (lc.completed_at - lc.task_created_at)) / 3600.0) from latest_completion lc)
    from counts;
end;
$$;
revoke all on function public.analytics_summary(uuid) from public, anon;
grant execute on function public.analytics_summary(uuid) to authenticated;
