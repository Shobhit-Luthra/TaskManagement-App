-- Soft deletion remains reversible while preserving a durable activity record.
create or replace function public.soft_delete_task(p_task_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.tasks set deleted_at = now() where id = p_task_id;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'deleted', jsonb_build_object('title', existing_task.title));
end;
$$;

revoke all on function public.soft_delete_task(uuid) from public;
grant execute on function public.soft_delete_task(uuid) to authenticated;
