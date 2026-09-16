create or replace function public.transfer_ownership(p_project_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  new_owner_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role = 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select memberships.role into new_owner_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_new_owner_id;
  if new_owner_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = '22023'; end if;

  update public.memberships set role = 'admin' where memberships.project_id = p_project_id and memberships.user_id = current_user_id;
  update public.memberships set role = 'owner' where memberships.project_id = p_project_id and memberships.user_id = p_new_owner_id;
  update public.projects set owner_id = p_new_owner_id where projects.id = p_project_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, 'project', p_project_id, 'role_changed', jsonb_build_object('newOwnerId', p_new_owner_id));
end;
$$;
revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

create or replace function public.archive_project(p_project_id uuid, p_is_archived boolean)
returns table (id uuid, is_archived boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); project_row public.projects%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.projects set is_archived = p_is_archived where projects.id = p_project_id and projects.deleted_at is null returning * into project_row;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  return query select project_row.id, project_row.is_archived;
end;
$$;
revoke all on function public.archive_project(uuid, boolean) from public;
grant execute on function public.archive_project(uuid, boolean) to authenticated;

-- Cascades deleted_at so RLS's existing `deleted_at is null` predicates on
-- projects/columns/tasks hide everything immediately; memberships/invitations
-- have no deleted_at, so they are deleted outright (nothing else references
-- them, and re-creating a project with the same id is impossible — it's a
-- fresh uuid every time).
create or replace function public.soft_delete_project(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role = 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.projects set deleted_at = now() where projects.id = p_project_id;
  update public.columns set deleted_at = now() where columns.project_id = p_project_id and columns.deleted_at is null;
  update public.tasks set deleted_at = now() where tasks.project_id = p_project_id and tasks.deleted_at is null;
  delete from public.invitations where invitations.project_id = p_project_id;
  delete from public.memberships where memberships.project_id = p_project_id;
end;
$$;
revoke all on function public.soft_delete_project(uuid) from public;
grant execute on function public.soft_delete_project(uuid) to authenticated;
