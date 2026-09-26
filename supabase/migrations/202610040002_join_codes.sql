-- Board join codes (design 2026-09-26): one shared 6-digit code per project.
-- Entering a code only creates a join *request*; an owner/admin approves it
-- and chooses the role at that moment. The code is stored in plaintext so
-- admins can display it again — hashing a 10^6 space protects nothing, and
-- approval (not the code) is the membership gate. Reads go through RLS or
-- the list RPCs below; writes only through RPCs.

create or replace function public.is_project_admin(target_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where project_id = target_project and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;
revoke all on function public.is_project_admin(uuid) from public, anon;
grant execute on function public.is_project_admin(uuid) to authenticated;

create table public.project_join_codes (
  project_id uuid primary key references public.projects(id) on delete cascade,
  code char(6) not null unique check (code ~ '^[0-9]{6}$'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  disabled_at timestamptz
);
alter table public.project_join_codes enable row level security;
alter table public.project_join_codes force row level security;
create policy project_join_codes_admin_read on public.project_join_codes for select to authenticated
  using (public.is_project_admin(project_id));

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  granted_role public.membership_role,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index join_requests_one_pending on public.join_requests(project_id, user_id) where status = 'pending';
create index idx_join_requests_project_status on public.join_requests(project_id, status, created_at desc);
create index idx_join_requests_user on public.join_requests(user_id, created_at desc);
alter table public.join_requests enable row level security;
alter table public.join_requests force row level security;
create policy join_requests_admin_or_self_read on public.join_requests for select to authenticated
  using (join_requests.user_id = (select auth.uid()) or public.is_project_admin(join_requests.project_id));

-- 6 digits from gen_random_uuid(): the first 8 hex digits of a v4 UUID are
-- CSPRNG output. Modulo bias (2^32 mod 10^6) is negligible.
create or replace function public.random_join_code() returns char(6)
language sql volatile set search_path = public as $$
  select lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0')::char(6);
$$;
revoke all on function public.random_join_code() from public, anon, authenticated;

create or replace function public.generate_join_code(p_project_id uuid)
returns table (code char(6), expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  code_row public.project_join_codes%rowtype;
  attempt integer;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  perform 1 from public.projects p where p.id = p_project_id and p.deleted_at is null;
  if not found or not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.projects p where p.id = p_project_id and p.is_archived) then
    raise exception 'PROJECT_ARCHIVED' using errcode = '22023';
  end if;

  for attempt in 1..5 loop
    begin
      insert into public.project_join_codes as c (project_id, code, created_by, created_at, expires_at, disabled_at)
      values (p_project_id, public.random_join_code(), current_user_id, now(), now() + interval '7 days', null)
      on conflict (project_id) do update
        set code = excluded.code, created_by = excluded.created_by, created_at = excluded.created_at,
            expires_at = excluded.expires_at, disabled_at = null
      returning c.* into code_row;
      exit;
    exception when unique_violation then
      -- Collided with another project's live code; draw again.
      code_row := null;
    end;
  end loop;
  if code_row.project_id is null then raise exception 'JOIN_CODE_UNAVAILABLE' using errcode = 'P0001'; end if;

  return query select code_row.code, code_row.expires_at;
end;
$$;

create or replace function public.disable_join_code(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.project_join_codes set disabled_at = now()
  where project_join_codes.project_id = p_project_id and project_join_codes.disabled_at is null;
end;
$$;

-- Every "no usable code" case raises the same P0002 INVALID_CODE so a caller
-- cannot distinguish a real-but-expired code from one that never existed.
create or replace function public.request_to_join(p_code text)
returns table (request_id uuid, project_id uuid, project_name varchar, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_project_id uuid;
  target_project_name varchar;
  request_row public.join_requests%rowtype;
  requester_name varchar;
  admin_ids uuid[];
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'INVALID_CODE_FORMAT' using errcode = '22023'; end if;

  select p.id, p.name into target_project_id, target_project_name
  from public.project_join_codes c
  join public.projects p on p.id = c.project_id
  where c.code = p_code and c.disabled_at is null and c.expires_at > now()
    and p.deleted_at is null and not p.is_archived;
  if not found then raise exception 'INVALID_CODE' using errcode = 'P0002'; end if;

  if exists (select 1 from public.memberships m where m.project_id = target_project_id and m.user_id = current_user_id) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  select * into request_row from public.join_requests r
  where r.project_id = target_project_id and r.user_id = current_user_id and r.status = 'pending';
  if found then
    return query select request_row.id, target_project_id, target_project_name, request_row.status;
    return;
  end if;

  if (select count(*) from public.join_requests r where r.project_id = target_project_id and r.status = 'pending') >= 50 then
    raise exception 'JOIN_QUEUE_FULL' using errcode = 'P0003';
  end if;

  insert into public.join_requests as r (project_id, user_id)
  values (target_project_id, current_user_id)
  on conflict do nothing
  returning r.* into request_row;
  if request_row.id is null then
    -- Lost a race with our own concurrent request; return the winner.
    select * into request_row from public.join_requests r
    where r.project_id = target_project_id and r.user_id = current_user_id and r.status = 'pending';
    return query select request_row.id, target_project_id, target_project_name, request_row.status;
    return;
  end if;

  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (target_project_id, current_user_id, 'join_request', request_row.id, 'join_requested', null);

  select u.display_name into requester_name from public.users u where u.id = current_user_id;
  select array_agg(m.user_id) into admin_ids from public.memberships m
  where m.project_id = target_project_id and m.role in ('owner', 'admin');
  perform public.enqueue_notifications(
    'join_requested', target_project_id, null, current_user_id, coalesce(admin_ids, '{}'),
    jsonb_build_object('requesterName', requester_name, 'projectName', target_project_name, 'requestId', request_row.id)
  );

  return query select request_row.id, target_project_id, target_project_name, request_row.status;
end;
$$;

-- Approve requires the approver to choose the role; it can never be owner or
-- rank at/above the approver's own role (BR-2).
create or replace function public.decide_join_request(
  p_request_id uuid, p_approve boolean, p_role public.membership_role default null
) returns table (request_id uuid, project_id uuid, user_id uuid, status text, granted_role public.membership_role)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  request_row public.join_requests%rowtype;
  caller_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into request_row from public.join_requests r where r.id = p_request_id for update;
  if not found or not public.is_project_member(request_row.project_id) then
    raise exception 'JOIN_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  select m.role into caller_role from public.memberships m
  where m.project_id = request_row.project_id and m.user_id = current_user_id;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if request_row.status <> 'pending' then raise exception 'JOIN_REQUEST_DECIDED' using errcode = 'P0003'; end if;
  if p_approve is null then raise exception 'DECISION_REQUIRED' using errcode = '22023'; end if;

  if p_approve then
    if p_role is null then raise exception 'ROLE_REQUIRED' using errcode = '22023'; end if;
    if p_role = 'owner' or public.membership_role_rank(p_role) >= public.membership_role_rank(caller_role) then
      raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501';
    end if;
    update public.join_requests r
      set status = 'approved', granted_role = p_role, decided_by = current_user_id, decided_at = now()
      where r.id = request_row.id
      returning r.* into request_row;
    insert into public.memberships (project_id, user_id, role)
    values (request_row.project_id, request_row.user_id, p_role)
    on conflict (project_id, user_id) do nothing;
    insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
    values (request_row.project_id, current_user_id, 'membership', request_row.user_id, 'member_added',
      jsonb_build_object('role', p_role, 'via', 'join_code'));
  else
    update public.join_requests r
      set status = 'denied', decided_by = current_user_id, decided_at = now()
      where r.id = request_row.id
      returning r.* into request_row;
    insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
    values (request_row.project_id, current_user_id, 'join_request', request_row.id, 'join_denied',
      jsonb_build_object('userId', request_row.user_id));
  end if;

  return query select request_row.id, request_row.project_id, request_row.user_id, request_row.status, request_row.granted_role;
end;
$$;

create or replace function public.cancel_join_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  delete from public.join_requests r
  where r.id = p_request_id and r.user_id = current_user_id and r.status = 'pending';
  if not found then raise exception 'JOIN_REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

-- Admin view of pending requests. Requesters are not project peers yet, so
-- their profile is not readable through users RLS; the email is shown so an
-- admin can recognise who is asking before granting access.
create or replace function public.list_join_requests(p_project_id uuid)
returns table (id uuid, user_id uuid, display_name varchar, email varchar, avatar_url text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_admin(p_project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select r.id, r.user_id, u.display_name, u.email::varchar, u.avatar_url::text, r.created_at
    from public.join_requests r join public.users u on u.id = r.user_id
    where r.project_id = p_project_id and r.status = 'pending'
    order by r.created_at;
end;
$$;

-- The requester's own pending requests. Project names come from here because
-- a non-member cannot read projects through RLS.
create or replace function public.list_my_join_requests()
returns table (id uuid, project_id uuid, project_name varchar, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  return query
    select r.id, r.project_id, p.name, r.created_at
    from public.join_requests r join public.projects p on p.id = r.project_id and p.deleted_at is null
    where r.user_id = current_user_id and r.status = 'pending'
    order by r.created_at desc;
end;
$$;

create or replace function public.notification_category_for(p_type public.notification_type)
returns public.notification_category language sql immutable set search_path = public as $$
  select case p_type
    when 'task_assigned' then 'assignment'::public.notification_category
    when 'task_unassigned' then 'assignment'::public.notification_category
    when 'mentioned' then 'mention'::public.notification_category
    when 'status_changed' then 'status_change'::public.notification_category
    when 'due_soon' then 'due_soon'::public.notification_category
    when 'digest_ready' then 'digest'::public.notification_category
    when 'join_requested' then 'membership'::public.notification_category end;
$$;

revoke all on function public.generate_join_code(uuid) from public, anon;
revoke all on function public.disable_join_code(uuid) from public, anon;
revoke all on function public.request_to_join(text) from public, anon;
revoke all on function public.decide_join_request(uuid, boolean, public.membership_role) from public, anon;
revoke all on function public.cancel_join_request(uuid) from public, anon;
revoke all on function public.list_join_requests(uuid) from public, anon;
revoke all on function public.list_my_join_requests() from public, anon;
grant execute on function public.generate_join_code(uuid) to authenticated;
grant execute on function public.disable_join_code(uuid) to authenticated;
grant execute on function public.request_to_join(text) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean, public.membership_role) to authenticated;
grant execute on function public.cancel_join_request(uuid) to authenticated;
grant execute on function public.list_join_requests(uuid) to authenticated;
grant execute on function public.list_my_join_requests() to authenticated;
