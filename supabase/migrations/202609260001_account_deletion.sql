-- Mirrors soft_delete_project's Owner guard one level up: a user cannot delete
-- their own account while they are the sole Owner of any live project. The
-- users row is ANONYMISED, not deleted — tasks.created_by, comments.author_id
-- and activity.actor_id reference it and the audit trail must survive.
create or replace function public.delete_own_account()
returns table (deleted boolean, tombstone_email text)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  sole_owner_projects jsonb;
  new_email text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;

  select jsonb_agg(jsonb_build_object('projectId', p.id, 'projectName', p.name))
    into sole_owner_projects
    from public.memberships m
    join public.projects p on p.id = m.project_id and p.deleted_at is null
    where m.user_id = current_user_id
      and m.role = 'owner'
      and not exists (
        select 1 from public.memberships other
        where other.project_id = m.project_id
          and other.role = 'owner'
          and other.user_id <> current_user_id
      );

  if sole_owner_projects is not null then
    raise exception 'ACCOUNT_DELETE_BLOCKED' using errcode = '42501', detail = sole_owner_projects::text;
  end if;

  new_email := 'deleted-' || gen_random_uuid()::text || '@kanbo.invalid';

  update public.tasks t
    set assignee_id = null
    where t.assignee_id = current_user_id and t.deleted_at is null;

  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  select m.project_id, current_user_id, 'membership', current_user_id, 'member_removed',
         jsonb_build_object('userId', current_user_id, 'reason', 'account_deleted')
    from public.memberships m
    where m.user_id = current_user_id;

  delete from public.memberships m where m.user_id = current_user_id;
  delete from public.notifications n where n.user_id = current_user_id;
  delete from public.notification_queue q where q.user_id = current_user_id;
  delete from public.notification_preferences np where np.user_id = current_user_id;
  delete from public.idempotency_keys k where k.user_id = current_user_id;

  update public.users u
    set display_name = 'Deleted user',
        email = new_email::citext,
        avatar_url = null,
        deleted_at = now()
    where u.id = current_user_id;

  return query select true, new_email;
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
