-- Triggers keep notification fan-out in the same transaction as existing RPCs,
-- without replacing their concurrency checks or introducing RPC overloads.
create function public.notify_task_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  recipients uuid[];
  column_name text;
begin
  if actor is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      perform public.enqueue_notifications('task_assigned', new.project_id, new.id, actor, array[new.assignee_id], jsonb_build_object('taskTitle', new.title));
    end if;
    return new;
  end if;
  if old.assignee_id is distinct from new.assignee_id then
    if old.assignee_id is not null then
      perform public.enqueue_notifications('task_unassigned', new.project_id, new.id, actor, array[old.assignee_id], jsonb_build_object('taskTitle', new.title));
    end if;
    if new.assignee_id is not null then
      perform public.enqueue_notifications('task_assigned', new.project_id, new.id, actor, array[new.assignee_id], jsonb_build_object('taskTitle', new.title));
    end if;
  end if;
  if old.column_id is distinct from new.column_id then
    select array_agg(w.user_id) into recipients from (
      select new.created_by as user_id union select new.assignee_id
      union select c.author_id from public.comments c where c.task_id = new.id and c.deleted_at is null
    ) w;
    select c.name into column_name from public.columns c where c.id = new.column_id;
    perform public.enqueue_notifications('status_changed', new.project_id, new.id, actor, recipients,
      jsonb_build_object('taskTitle', new.title, 'toColumn', column_name));
  end if;
  return new;
end;
$$;
revoke all on function public.notify_task_changes() from public, anon, authenticated;
create trigger tasks_notify after insert or update of assignee_id, column_id on public.tasks for each row execute function public.notify_task_changes();

create function public.notify_comment_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare recipients uuid[]; task_title text;
begin
  if auth.uid() is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'INSERT' then recipients := new.mentioned_user_ids;
  else
    select array_agg(v.user_id) into recipients from unnest(new.mentioned_user_ids) as v(user_id)
      where not (v.user_id = any(old.mentioned_user_ids));
  end if;
  select t.title into task_title from public.tasks t where t.id = new.task_id;
  perform public.enqueue_notifications('mentioned', new.project_id, new.task_id, auth.uid(), recipients,
    jsonb_build_object('taskTitle', task_title, 'commentId', new.id));
  return new;
end;
$$;
revoke all on function public.notify_comment_mentions() from public, anon, authenticated;
create trigger comments_notify after insert or update of mentioned_user_ids on public.comments for each row execute function public.notify_comment_mentions();
