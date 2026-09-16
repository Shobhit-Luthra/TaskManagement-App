create or replace function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role public.membership_role)
returns table (user_id uuid, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  target_role public.membership_role;
  updated public.memberships%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select memberships.role into caller_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = current_user_id;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select memberships.role into target_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  if target_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_role = 'owner' or p_role = 'owner' then raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501'; end if;
  if public.membership_role_rank(p_role) >= public.membership_role_rank(caller_role) then
    raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501';
  end if;

  update public.memberships set role = p_role where memberships.project_id = p_project_id and memberships.user_id = p_user_id returning * into updated;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, from_value, to_value)
  values (p_project_id, current_user_id, 'membership', p_user_id, 'role_changed', jsonb_build_object('role', target_role), jsonb_build_object('role', p_role));
  return query select updated.user_id, updated.role;
end;
$$;
revoke all on function public.change_member_role(uuid, uuid, public.membership_role) from public;
grant execute on function public.change_member_role(uuid, uuid, public.membership_role) to authenticated;

create or replace function public.remove_member(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  target_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select memberships.role into caller_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = current_user_id;
  if caller_role not in ('owner', 'admin') and current_user_id <> p_user_id then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select memberships.role into target_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  if target_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_role = 'owner' then raise exception 'CANNOT_REMOVE_OWNER' using errcode = '42501'; end if;
  if caller_role = 'admin' and target_role = 'admin' and current_user_id <> p_user_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.tasks set assignee_id = null where tasks.project_id = p_project_id and tasks.assignee_id = p_user_id and tasks.deleted_at is null;
  delete from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, 'membership', p_user_id, 'member_removed', jsonb_build_object('userId', p_user_id));
end;
$$;
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

create or replace function public.leave_project(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.remove_member(p_project_id, auth.uid());
end;
$$;
revoke all on function public.leave_project(uuid) from public;
grant execute on function public.leave_project(uuid) to authenticated;
