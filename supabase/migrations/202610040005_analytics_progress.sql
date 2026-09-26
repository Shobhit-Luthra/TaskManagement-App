-- Progress views for the admin-only Analytics tab (design 2026-09-26):
-- per-column breakdown, per-member progress, at-risk tasks, and priority /
-- label breakdowns. Same conventions as 202609250004: security definer,
-- admin gate raising P0002, CURRENT column flags (G4), "today" in the
-- project's timezone (G3), soft-deleted tasks and columns excluded.

-- Cycle-time and completion subqueries filter activity by (task_id, action);
-- only (project_id, created_at) was indexed.
create index if not exists idx_activity_task_action on public.activity(task_id, action, created_at desc);

create or replace function public.analytics_column_breakdown(p_project_id uuid)
returns table (
  column_id uuid, column_name varchar, column_position double precision,
  is_done_column boolean, is_in_progress_column boolean, task_count integer
)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    select c.id, c.name, c.position::double precision, c.is_done_column, c.is_in_progress_column,
      count(t.id)::integer
    from public.columns c
    left join public.tasks t on t.column_id = c.id and t.deleted_at is null
    where c.project_id = p_project_id and c.deleted_at is null
    group by c.id, c.name, c.position, c.is_done_column, c.is_in_progress_column
    order by c.position;
end;
$$;

-- One row per current member plus an "Unassigned" row (member_user_id null).
-- completed_in_period counts tasks now in the done column whose latest
-- completion (after any reopen — same rule as analytics_summary) falls in
-- the last p_days days.
create or replace function public.analytics_member_progress(p_project_id uuid, p_days integer default 30)
returns table (
  member_user_id uuid, display_name varchar, avatar_url text, member_role public.membership_role,
  open_count integer, in_progress_count integer, completed_in_period integer,
  overdue_count integer, due_soon_count integer
)
language plpgsql security definer set search_path = public as $$
declare
  project_timezone text;
  today_in_project date;
  period_start timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;
  today_in_project := (now() at time zone project_timezone)::date;
  period_start := now() - make_interval(days => p_days);

  return query
    with live_tasks as (
      select t.id, t.assignee_id, t.due_date, c.is_done_column, c.is_in_progress_column
      from public.tasks t
      join public.columns c on c.id = t.column_id
      where t.project_id = p_project_id and t.deleted_at is null
    ),
    recent_completion as (
      select lt.id as task_id
      from live_tasks lt
      where lt.is_done_column
        and (
          select max(a.created_at) from public.activity a where a.task_id = lt.id and a.action = 'completed'
        ) > greatest(
          period_start,
          coalesce(
            (select max(r.created_at) from public.activity r where r.task_id = lt.id and r.action = 'reopened'),
            '-infinity'::timestamptz
          )
        )
    ),
    per_assignee as (
      select
        lt.assignee_id,
        count(*) filter (where not lt.is_done_column)::integer as open_count,
        count(*) filter (where lt.is_in_progress_column and not lt.is_done_column)::integer as in_progress_count,
        count(rc.task_id)::integer as completed_in_period,
        count(*) filter (where not lt.is_done_column and lt.due_date < today_in_project)::integer as overdue_count,
        count(*) filter (
          where not lt.is_done_column and lt.due_date >= today_in_project and lt.due_date < today_in_project + 7
        )::integer as due_soon_count
      from live_tasks lt
      left join recent_completion rc on rc.task_id = lt.id
      group by lt.assignee_id
    )
    select m.user_id, u.display_name, u.avatar_url::text, m.role,
      coalesce(pa.open_count, 0), coalesce(pa.in_progress_count, 0), coalesce(pa.completed_in_period, 0),
      coalesce(pa.overdue_count, 0), coalesce(pa.due_soon_count, 0)
    from public.memberships m
    join public.users u on u.id = m.user_id
    left join per_assignee pa on pa.assignee_id = m.user_id
    where m.project_id = p_project_id
    union all
    -- Unassigned work, plus tasks still assigned to people who have left.
    select null::uuid, 'Unassigned'::varchar, null::text, null::public.membership_role,
      coalesce(sum(pa.open_count), 0)::integer, coalesce(sum(pa.in_progress_count), 0)::integer,
      coalesce(sum(pa.completed_in_period), 0)::integer, coalesce(sum(pa.overdue_count), 0)::integer,
      coalesce(sum(pa.due_soon_count), 0)::integer
    from per_assignee pa
    where pa.assignee_id is null
      or not exists (select 1 from public.memberships m2 where m2.project_id = p_project_id and m2.user_id = pa.assignee_id)
    order by 2;
end;
$$;

-- Open tasks overdue or due within 3 days, most urgent first.
create or replace function public.analytics_at_risk(p_project_id uuid, p_limit integer default 50)
returns table (
  task_id uuid, title varchar, due_date date, priority public.task_priority, column_name varchar,
  assignee_id uuid, assignee_name varchar, is_overdue boolean, days_until_due integer
)
language plpgsql security definer set search_path = public as $$
declare
  project_timezone text;
  today_in_project date;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'INVALID_LIMIT' using errcode = '22023'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;
  today_in_project := (now() at time zone project_timezone)::date;

  return query
    select t.id, t.title, t.due_date, t.priority, c.name, t.assignee_id, u.display_name,
      t.due_date < today_in_project, (t.due_date - today_in_project)::integer
    from public.tasks t
    join public.columns c on c.id = t.column_id
    left join public.users u on u.id = t.assignee_id
    where t.project_id = p_project_id and t.deleted_at is null and not c.is_done_column
      and t.due_date is not null and t.due_date <= today_in_project + 3
    order by t.due_date, t.priority desc, t.created_at
    limit p_limit;
end;
$$;

-- Open vs done split by priority (every priority, even empty) and by label.
create or replace function public.analytics_breakdown(p_project_id uuid)
returns table (dimension text, key text, name text, color text, open_count integer, done_count integer)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    with live_tasks as (
      select t.id, t.priority, c.is_done_column
      from public.tasks t
      join public.columns c on c.id = t.column_id
      where t.project_id = p_project_id and t.deleted_at is null
    )
    select 'priority'::text, p.value::text, initcap(p.value::text), null::text,
      count(lt.id) filter (where not lt.is_done_column)::integer,
      count(lt.id) filter (where lt.is_done_column)::integer
    from unnest(enum_range(null::public.task_priority)) with ordinality as p(value, ord)
    left join live_tasks lt on lt.priority = p.value
    group by p.value, p.ord
    union all
    select 'label'::text, l.id::text, l.name::text, l.color::text,
      count(lt.id) filter (where not lt.is_done_column)::integer,
      count(lt.id) filter (where lt.is_done_column)::integer
    from public.labels l
    left join public.task_labels tl on tl.label_id = l.id
    left join live_tasks lt on lt.id = tl.task_id
    where l.project_id = p_project_id
    group by l.id, l.name, l.color
    -- Priority rows first; the client orders them urgent -> low.
    order by 1 desc, 5 desc, 3;
end;
$$;

revoke all on function public.analytics_column_breakdown(uuid) from public, anon;
revoke all on function public.analytics_member_progress(uuid, integer) from public, anon;
revoke all on function public.analytics_at_risk(uuid, integer) from public, anon;
revoke all on function public.analytics_breakdown(uuid) from public, anon;
grant execute on function public.analytics_column_breakdown(uuid) to authenticated;
grant execute on function public.analytics_member_progress(uuid, integer) to authenticated;
grant execute on function public.analytics_at_risk(uuid, integer) to authenticated;
grant execute on function public.analytics_breakdown(uuid) to authenticated;
