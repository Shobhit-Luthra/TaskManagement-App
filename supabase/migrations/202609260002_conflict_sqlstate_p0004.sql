-- PostgREST 14 treats SQLSTATE 40001 (serialization_failure) as transient and
-- retries the transaction indefinitely, so a stale optimistic-concurrency write
-- hung instead of returning a conflict. Re-raise with a custom, non-transient
-- SQLSTATE; the API maps P0004 to 409 CONFLICT. Bodies otherwise unchanged from
-- 202609250001 (update_task) and 202609210003 (update_comment).

create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority public.task_priority,
  p_assignee_id uuid default null,
  p_expected_updated_at timestamptz default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date,
  priority public.task_priority, "position" double precision, assignee_id uuid,
  created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  previous_assignee_id uuid;
  before_value jsonb;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found or not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_expected_updated_at is not null and p_expected_updated_at is distinct from existing_task.updated_at then
    raise exception 'CONFLICT' using errcode = 'P0004';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.memberships where memberships.project_id = existing_task.project_id and memberships.user_id = p_assignee_id
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '22023'; end if;
  previous_assignee_id := existing_task.assignee_id;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', previous_assignee_id);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority, assignee_id = p_assignee_id
  where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id));
  if previous_assignee_id is distinct from existing_task.assignee_id then
    insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
    values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id,
      case when existing_task.assignee_id is null then 'unassigned'::public.activity_action else 'assigned'::public.activity_action end,
      jsonb_build_object('assigneeId', previous_assignee_id), jsonb_build_object('assigneeId', existing_task.assignee_id));
  end if;
  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description,
    existing_task.due_date, existing_task.priority, existing_task.position, existing_task.assignee_id,
    existing_task.created_at, existing_task.updated_at;
end;
$$;
revoke all on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) from public;
grant execute on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) to authenticated;

create or replace function public.update_comment(p_comment_id uuid, p_body text, p_mentioned_user_ids uuid[], p_expected_updated_at timestamptz)
returns table (id uuid, task_id uuid, author_id uuid, body text, mentioned_user_ids uuid[], created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_comment public.comments%rowtype;
  resolved_mentions uuid[];
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_comment from public.comments where comments.id = p_comment_id and comments.deleted_at is null for update;
  if not found or not public.is_project_member(existing_comment.project_id) then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_comment.project_id) or existing_comment.author_id <> current_user_id then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_expected_updated_at is distinct from existing_comment.updated_at then raise exception 'COMMENT_CONFLICT' using errcode = 'P0004'; end if;
  if p_body is null or char_length(p_body) not between 1 and 5000 then raise exception 'INVALID_COMMENT_BODY' using errcode = '22023'; end if;
  select coalesce(array_agg(memberships.user_id), '{}') into resolved_mentions
  from public.memberships where memberships.project_id = existing_comment.project_id and memberships.user_id = any(p_mentioned_user_ids);
  update public.comments set body = p_body, mentioned_user_ids = resolved_mentions where comments.id = p_comment_id returning * into existing_comment;
  return query select existing_comment.id, existing_comment.task_id, existing_comment.author_id, existing_comment.body, existing_comment.mentioned_user_ids, existing_comment.created_at, existing_comment.updated_at;
end;
$$;
revoke all on function public.update_comment(uuid, text, uuid[], timestamptz) from public;
grant execute on function public.update_comment(uuid, text, uuid[], timestamptz) to authenticated;
