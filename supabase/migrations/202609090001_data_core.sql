-- Kanbo data core. Apply only through `supabase db push` after linking the project.
create extension if not exists citext;
create extension if not exists pgcrypto;

create type public.membership_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.activity_action as enum ('created', 'updated', 'moved', 'assigned', 'unassigned', 'completed', 'reopened', 'deleted', 'restored', 'member_added', 'member_removed', 'role_changed');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  display_name varchar(80) not null check (char_length(trim(display_name)) between 1 and 80),
  avatar_url text,
  timezone varchar(64) not null default 'UTC',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), name varchar(120) not null check (char_length(trim(name)) between 1 and 120), description text check (description is null or char_length(description) <= 2000),
  owner_id uuid not null references public.users(id) on delete restrict, timezone varchar(64) not null default 'UTC', is_archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.memberships (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade, user_id uuid not null references public.users(id) on delete cascade,
  role public.membership_role not null default 'member', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(project_id, user_id)
);
create unique index memberships_one_owner on public.memberships(project_id) where role = 'owner';
create table public.invitations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade, email citext not null, role public.membership_role not null default 'member',
  token_hash text not null unique, invited_by uuid not null references public.users(id) on delete restrict, expires_at timestamptz not null default now() + interval '7 days', accepted_at timestamptz, created_at timestamptz not null default now()
);
create unique index invitations_pending_email on public.invitations(project_id, email) where accepted_at is null;
create table public.columns (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade, name varchar(60) not null check (char_length(trim(name)) between 1 and 60),
  position double precision not null check (position not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)), wip_limit smallint check (wip_limit is null or wip_limit > 0), is_done_column boolean not null default false, is_in_progress_column boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, unique(id, project_id)
);
create unique index columns_one_done on public.columns(project_id) where is_done_column and deleted_at is null;
create table public.tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, column_id uuid not null, title varchar(200) not null check (char_length(trim(title)) between 1 and 200), description text check (description is null or char_length(description) <= 20000),
  assignee_id uuid references public.users(id) on delete set null, due_date date, priority public.task_priority not null default 'medium', position double precision not null check (position not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)), mutation_id uuid, created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key (column_id, project_id) references public.columns(id, project_id) on delete restrict
);
create table public.subtasks (id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade, title varchar(200) not null check (char_length(trim(title)) between 1 and 200), is_completed boolean not null default false, position double precision not null check (position not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.activity (id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade, actor_id uuid references public.users(id) on delete set null, task_id uuid references public.tasks(id) on delete set null, entity_type varchar(20) not null, entity_id uuid not null, action public.activity_action not null, from_value jsonb, to_value jsonb, created_at timestamptz not null default now());

create index idx_memberships_lookup on public.memberships(user_id, project_id);
create index idx_columns_board on public.columns(project_id, position) where deleted_at is null;
create index idx_tasks_board on public.tasks(project_id, column_id, position) where deleted_at is null;
create index idx_tasks_assignee on public.tasks(assignee_id, due_date) where deleted_at is null;
create index idx_tasks_due on public.tasks(project_id, due_date) where due_date is not null and deleted_at is null;
create index idx_activity_project_time on public.activity(project_id, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger memberships_updated_at before update on public.memberships for each row execute function public.set_updated_at();
create trigger columns_updated_at before update on public.columns for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger subtasks_updated_at before update on public.subtasks for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.users(id, email, display_name) values (new.id, new.email, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.is_project_member(target_project uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.memberships where project_id = target_project and user_id = auth.uid()); $$;
create or replace function public.can_write_project(target_project uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.memberships where project_id = target_project and user_id = auth.uid() and role <> 'viewer'); $$;

alter table public.users enable row level security; alter table public.users force row level security;
alter table public.projects enable row level security; alter table public.projects force row level security;
alter table public.memberships enable row level security; alter table public.memberships force row level security;
alter table public.invitations enable row level security; alter table public.invitations force row level security;
alter table public.columns enable row level security; alter table public.columns force row level security;
alter table public.tasks enable row level security; alter table public.tasks force row level security;
alter table public.subtasks enable row level security; alter table public.subtasks force row level security;
alter table public.activity enable row level security; alter table public.activity force row level security;
create policy users_self on public.users for select using (id = auth.uid());
create policy projects_member_read on public.projects for select using (deleted_at is null and public.is_project_member(id));
create policy memberships_member_read on public.memberships for select using (public.is_project_member(project_id));
create policy invitations_admin_read on public.invitations for select using (exists(select 1 from public.memberships m where m.project_id = invitations.project_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
create policy columns_member_read on public.columns for select using (deleted_at is null and public.is_project_member(project_id));
create policy columns_member_write on public.columns for all using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));
create policy tasks_member_read on public.tasks for select using (deleted_at is null and public.is_project_member(project_id));
create policy tasks_member_write on public.tasks for all using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));
create policy subtasks_member_read on public.subtasks for select using (exists(select 1 from public.tasks t where t.id = subtasks.task_id and t.deleted_at is null and public.is_project_member(t.project_id)));
create policy activity_member_read on public.activity for select using (public.is_project_member(project_id));
create policy activity_member_insert on public.activity for insert with check (public.can_write_project(project_id));

-- The first-value journey must either create every required record or create none.
-- Direct project/membership inserts remain unavailable to authenticated clients.
create or replace function public.create_project(
  p_name text,
  p_description text default null,
  p_timezone text default 'UTC'
) returns table (
  id uuid,
  name varchar,
  description text,
  timezone varchar,
  role public.membership_role,
  columns jsonb,
  created_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_row public.projects%rowtype;
  default_columns jsonb;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_PROJECT_NAME' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 2000 then raise exception 'INVALID_PROJECT_DESCRIPTION' using errcode = '22023'; end if;
  if p_timezone is null or char_length(trim(p_timezone)) not between 1 and 64 then raise exception 'INVALID_TIMEZONE' using errcode = '22023'; end if;
  if not exists (select 1 from public.users where users.id = current_user_id and deleted_at is null) then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.projects (name, description, owner_id, timezone)
  values (trim(p_name), nullif(trim(p_description), ''), current_user_id, trim(p_timezone))
  returning * into project_row;
  insert into public.memberships (project_id, user_id, role) values (project_row.id, current_user_id, 'owner');
  insert into public.columns (project_id, name, position, is_in_progress_column, is_done_column) values
    (project_row.id, 'To Do', 1, false, false),
    (project_row.id, 'In Progress', 2, true, false),
    (project_row.id, 'Done', 3, false, true);
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (project_row.id, current_user_id, 'project', project_row.id, 'created', jsonb_build_object('name', project_row.name));

  select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'position', c.position, 'isDoneColumn', c.is_done_column, 'isInProgressColumn', c.is_in_progress_column) order by c.position)
    into default_columns from public.columns c where c.project_id = project_row.id;
  return query select project_row.id, project_row.name, project_row.description, project_row.timezone, 'owner'::public.membership_role, default_columns, project_row.created_at;
end;
$$;
revoke all on function public.create_project(text, text, text) from public;
grant execute on function public.create_project(text, text, text) to authenticated;
