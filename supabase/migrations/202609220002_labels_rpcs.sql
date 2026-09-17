create or replace function public.create_label(p_project_id uuid, p_name text, p_color text)
returns table (id uuid, project_id uuid, name varchar, color varchar, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); label_row public.labels%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where memberships.project_id = p_project_id and memberships.user_id = current_user_id and memberships.role in ('owner','admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 50 then raise exception 'INVALID_LABEL_NAME' using errcode = '22023'; end if;
  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_LABEL_COLOR' using errcode = '22023'; end if;
  insert into public.labels (project_id, name, color) values (p_project_id, trim(p_name)::citext, upper(p_color)) returning * into label_row;
  return query select label_row.id, label_row.project_id, label_row.name::varchar, label_row.color::varchar, label_row.created_at;
end;
$$;
revoke all on function public.create_label(uuid, text, text) from public;
grant execute on function public.create_label(uuid, text, text) to authenticated;

create or replace function public.update_label(p_label_id uuid, p_name text, p_color text)
returns table (id uuid, project_id uuid, name varchar, color varchar, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); label_row public.labels%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into label_row from public.labels where labels.id = p_label_id for update;
  if not found or not public.is_project_member(label_row.project_id) then raise exception 'LABEL_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where memberships.project_id = label_row.project_id and memberships.user_id = current_user_id and memberships.role in ('owner','admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 50 then raise exception 'INVALID_LABEL_NAME' using errcode = '22023'; end if;
  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_LABEL_COLOR' using errcode = '22023'; end if;
  update public.labels set name = trim(p_name)::citext, color = upper(p_color) where labels.id = p_label_id returning * into label_row;
  return query select label_row.id, label_row.project_id, label_row.name::varchar, label_row.color::varchar, label_row.created_at;
end;
$$;
revoke all on function public.update_label(uuid, text, text) from public;
grant execute on function public.update_label(uuid, text, text) to authenticated;

create or replace function public.delete_label(p_label_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); label_row public.labels%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into label_row from public.labels where labels.id = p_label_id for update;
  if not found or not public.is_project_member(label_row.project_id) then raise exception 'LABEL_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where memberships.project_id = label_row.project_id and memberships.user_id = current_user_id and memberships.role in ('owner','admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.labels where labels.id = p_label_id;
end;
$$;
revoke all on function public.delete_label(uuid) from public;
grant execute on function public.delete_label(uuid) to authenticated;

create or replace function public.set_task_labels(p_task_id uuid, p_label_ids uuid[])
returns table (task_id uuid, label_ids uuid[])
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); parent_task public.tasks%rowtype; valid_label_ids uuid[];
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found or not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(array_agg(labels.id), '{}') into valid_label_ids from public.labels where labels.project_id = parent_task.project_id and labels.id = any(p_label_ids);
  delete from public.task_labels where task_labels.task_id = p_task_id and task_labels.label_id <> all(valid_label_ids);
  insert into public.task_labels (task_id, label_id) select p_task_id, unnest(valid_label_ids) on conflict (task_id, label_id) do nothing;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (parent_task.project_id, current_user_id, parent_task.id, 'task', parent_task.id, 'updated', jsonb_build_object('labelIds', to_jsonb(valid_label_ids)));
  return query select p_task_id, valid_label_ids;
end;
$$;
revoke all on function public.set_task_labels(uuid, uuid[]) from public;
grant execute on function public.set_task_labels(uuid, uuid[]) to authenticated;
