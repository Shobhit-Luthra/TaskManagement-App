-- Rank used to enforce "cannot grant >= own role" (BR-2): higher number = more privilege.
create or replace function public.membership_role_rank(r public.membership_role) returns smallint
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'member' then 2 when 'viewer' then 1 end;
$$;

create or replace function public.create_invitation(
  p_project_id uuid, p_email text, p_role public.membership_role, p_token_hash text
) returns table (
  id uuid, project_id uuid, email varchar, role public.membership_role, expires_at timestamptz, created_at timestamptz, resent boolean
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  existing_invitation public.invitations%rowtype;
  invitation_row public.invitations%rowtype;
  was_resent boolean := false;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- role/project_id qualified with the table name below: both are also OUT
  -- columns of this function's `returns table`, so bare references here
  -- would be ambiguous against those OUT-parameter variables.
  select memberships.role into caller_role from public.memberships
    where memberships.project_id = p_project_id and memberships.user_id = current_user_id;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if public.membership_role_rank(p_role) >= public.membership_role_rank(caller_role) then
    raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501';
  end if;
  if p_email is null or char_length(p_email) > 254 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then raise exception 'INVALID_TOKEN' using errcode = '22023'; end if;

  if exists (
    select 1 from public.memberships m join public.users u on u.id = m.user_id
    where m.project_id = p_project_id and u.email = p_email::citext
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  select * into existing_invitation from public.invitations
    where invitations.project_id = p_project_id and invitations.email = p_email::citext and invitations.accepted_at is null
    for update;

  if found then
    update public.invitations set role = p_role, token_hash = p_token_hash, expires_at = now() + interval '7 days'
      where invitations.id = existing_invitation.id returning * into invitation_row;
    was_resent := true;
  else
    insert into public.invitations (project_id, email, role, token_hash, invited_by)
    values (p_project_id, p_email::citext, p_role, p_token_hash, current_user_id)
    returning * into invitation_row;
  end if;

  return query select invitation_row.id, invitation_row.project_id, invitation_row.email, invitation_row.role, invitation_row.expires_at, invitation_row.created_at, was_resent;
end;
$$;
revoke all on function public.create_invitation(uuid, text, public.membership_role, text) from public;
grant execute on function public.create_invitation(uuid, text, public.membership_role, text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  target public.invitations%rowtype;
  caller_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into target from public.invitations where invitations.id = p_invitation_id;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select role into caller_role from public.memberships where project_id = target.project_id and user_id = current_user_id;
  if caller_role is null then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.invitations where invitations.id = p_invitation_id;
end;
$$;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;
