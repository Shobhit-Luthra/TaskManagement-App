-- Invitation acceptance (J4, S11, G11): peek (signed-out preview), accept
-- (single-use, email-matched), decline. P0003 (GONE) is used instead of
-- P0002 for expired/used tokens so the client can tell "wrong URL" apart
-- from "ask for a new invite".
alter table public.invitations add column declined_at timestamptz;

create or replace function public.peek_invitation(p_token_hash text)
returns table (project_name varchar, inviter_display_name varchar, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare inv public.invitations%rowtype;
begin
  select * into inv from public.invitations where invitations.token_hash = p_token_hash;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  return query
    select p.name, u.display_name, inv.role
    from public.projects p join public.users u on u.id = inv.invited_by
    where p.id = inv.project_id;
end;
$$;
revoke all on function public.peek_invitation(text) from public;
grant execute on function public.peek_invitation(text) to anon;
grant execute on function public.peek_invitation(text) to authenticated;

create or replace function public.accept_invitation(p_token_hash text)
returns table (project_id uuid, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  current_email citext;
  inv public.invitations%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into inv from public.invitations where invitations.token_hash = p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  select email into current_email from public.users where users.id = current_user_id;
  if current_email is distinct from inv.email then raise exception 'EMAIL_MISMATCH' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where memberships.project_id = inv.project_id and memberships.user_id = current_user_id) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  update public.invitations set accepted_at = now() where invitations.id = inv.id;
  insert into public.memberships (project_id, user_id, role) values (inv.project_id, current_user_id, inv.role);
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (inv.project_id, current_user_id, 'membership', current_user_id, 'member_added', jsonb_build_object('role', inv.role));

  return query select inv.project_id, inv.role;
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.decline_invitation(p_token_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  current_email citext;
  inv public.invitations%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into inv from public.invitations where invitations.token_hash = p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  select email into current_email from public.users where users.id = current_user_id;
  if current_email is distinct from inv.email then raise exception 'EMAIL_MISMATCH' using errcode = '42501'; end if;
  update public.invitations set declined_at = now() where invitations.id = inv.id;
end;
$$;
revoke all on function public.decline_invitation(text) from public;
grant execute on function public.decline_invitation(text) to authenticated;
