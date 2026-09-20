-- Bugfix: set_task_labels declares an OUT parameter named task_id (from
-- `returns table (task_id uuid, label_ids uuid[])`), which shadows the
-- task_labels.task_id column for any bare "task_id" identifier in embedded
-- SQL -- including an ON CONFLICT column-name target list, which Postgres
-- resolves through the same plpgsql variable-substitution path as ordinary
-- expressions. Confirmed by direct reproduction: the same bare-column ON
-- CONFLICT list raises 42702 "ambiguous" purely from a same-named variable
-- being in scope, even when never referenced as a value. Fix: reference the
-- unique constraint by name instead of by column list, following the same
-- pattern already used for notification_queue's conflict target.
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
  insert into public.task_labels (task_id, label_id) select p_task_id, unnest(valid_label_ids) on conflict on constraint task_labels_pkey do nothing;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (parent_task.project_id, current_user_id, parent_task.id, 'task', parent_task.id, 'updated', jsonb_build_object('labelIds', to_jsonb(valid_label_ids)));
  return query select p_task_id, valid_label_ids;
end;
$$;
revoke all on function public.set_task_labels(uuid, uuid[]) from public;
grant execute on function public.set_task_labels(uuid, uuid[]) to authenticated;
