create or replace function public.create_comment(p_task_id uuid, p_body text, p_mentioned_user_ids uuid[] default '{}')
returns table (id uuid, task_id uuid, author_id uuid, body text, mentioned_user_ids uuid[], created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  comment_row public.comments%rowtype;
  resolved_mentions uuid[];
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found or not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_body is null or char_length(p_body) not between 1 and 5000 then raise exception 'INVALID_COMMENT_BODY' using errcode = '22023'; end if;
  select coalesce(array_agg(memberships.user_id), '{}') into resolved_mentions
  from public.memberships where memberships.project_id = parent_task.project_id and memberships.user_id = any(p_mentioned_user_ids);
  insert into public.comments (project_id, task_id, author_id, body, mentioned_user_ids)
  values (parent_task.project_id, parent_task.id, current_user_id, p_body, resolved_mentions) returning * into comment_row;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (parent_task.project_id, current_user_id, parent_task.id, 'comment', comment_row.id, 'commented', jsonb_build_object('commentId', comment_row.id));
  return query select comment_row.id, comment_row.task_id, comment_row.author_id, comment_row.body, comment_row.mentioned_user_ids, comment_row.created_at, comment_row.updated_at;
end;
$$;
revoke all on function public.create_comment(uuid, text, uuid[]) from public;
grant execute on function public.create_comment(uuid, text, uuid[]) to authenticated;

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
  if p_expected_updated_at is distinct from existing_comment.updated_at then raise exception 'COMMENT_CONFLICT' using errcode = '40001'; end if;
  if p_body is null or char_length(p_body) not between 1 and 5000 then raise exception 'INVALID_COMMENT_BODY' using errcode = '22023'; end if;
  select coalesce(array_agg(memberships.user_id), '{}') into resolved_mentions
  from public.memberships where memberships.project_id = existing_comment.project_id and memberships.user_id = any(p_mentioned_user_ids);
  update public.comments set body = p_body, mentioned_user_ids = resolved_mentions where comments.id = p_comment_id returning * into existing_comment;
  return query select existing_comment.id, existing_comment.task_id, existing_comment.author_id, existing_comment.body, existing_comment.mentioned_user_ids, existing_comment.created_at, existing_comment.updated_at;
end;
$$;
revoke all on function public.update_comment(uuid, text, uuid[], timestamptz) from public;
grant execute on function public.update_comment(uuid, text, uuid[], timestamptz) to authenticated;

create or replace function public.soft_delete_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_comment public.comments%rowtype;
  caller_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_comment from public.comments where comments.id = p_comment_id and comments.deleted_at is null for update;
  if not found or not public.is_project_member(existing_comment.project_id) then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_comment.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select memberships.role into caller_role from public.memberships where memberships.project_id = existing_comment.project_id and memberships.user_id = current_user_id;
  if existing_comment.author_id <> current_user_id and caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.comments set deleted_at = now() where comments.id = p_comment_id;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (existing_comment.project_id, current_user_id, existing_comment.task_id, 'comment', existing_comment.id, 'deleted', jsonb_build_object('commentId', existing_comment.id));
end;
$$;
revoke all on function public.soft_delete_comment(uuid) from public;
grant execute on function public.soft_delete_comment(uuid) to authenticated;
