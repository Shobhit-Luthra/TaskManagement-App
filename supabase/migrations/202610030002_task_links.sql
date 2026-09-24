-- Named http(s) links on a task (spec 3B). Reads go through RLS; writes only
-- through the RPCs below. URLs are never fetched server-side.
create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  url varchar(2048) not null check (url ~* '^https?://[^[:space:]]+$'),
  title varchar(200) check (title is null or char_length(trim(title)) between 1 and 200),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_task_links_task on public.task_links(task_id, created_at);
alter table public.task_links enable row level security;
alter table public.task_links force row level security;
create policy task_links_member_read on public.task_links for select using (
  exists (
    select 1 from public.tasks t
    where t.id = task_links.task_id and t.deleted_at is null and public.is_project_member(t.project_id)
  )
);

create or replace function public.add_task_link(p_task_id uuid, p_url text, p_title text)
returns table (id uuid, task_id uuid, url varchar, title varchar, created_by uuid, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  link_row public.task_links%rowtype;
  clean_url text := trim(p_url);
  clean_title text := nullif(trim(p_title), '');
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found or not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if clean_url is null or char_length(clean_url) > 2048 or clean_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'INVALID_LINK_URL' using errcode = '22023';
  end if;
  if clean_title is not null and char_length(clean_title) > 200 then raise exception 'INVALID_LINK_TITLE' using errcode = '22023'; end if;
  if (select count(*) from public.task_links where task_links.task_id = parent_task.id) >= 50 then
    raise exception 'LINK_LIMIT' using errcode = '22023';
  end if;
  insert into public.task_links (project_id, task_id, url, title, created_by)
  values (parent_task.project_id, parent_task.id, clean_url, clean_title, current_user_id)
  returning * into link_row;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (parent_task.project_id, current_user_id, parent_task.id, 'task_link', link_row.id, 'link_added',
    jsonb_build_object('url', link_row.url, 'title', link_row.title));
  return query select link_row.id, link_row.task_id, link_row.url, link_row.title, link_row.created_by, link_row.created_at;
end;
$$;

create or replace function public.delete_task_link(p_task_id uuid, p_link_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  link_row public.task_links%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select l.* into link_row from public.task_links l
  join public.tasks t on t.id = l.task_id and t.deleted_at is null
  where l.id = p_link_id and l.task_id = p_task_id
  for update of l;
  if not found or not public.is_project_member(link_row.project_id) then raise exception 'LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(link_row.project_id) or (
    link_row.created_by is distinct from current_user_id and not exists (
      select 1 from public.memberships m
      where m.project_id = link_row.project_id and m.user_id = current_user_id and m.role in ('owner', 'admin')
    )
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.task_links where task_links.id = link_row.id;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value)
  values (link_row.project_id, current_user_id, link_row.task_id, 'task_link', link_row.id, 'link_removed',
    jsonb_build_object('url', link_row.url, 'title', link_row.title));
end;
$$;

revoke all on function public.add_task_link(uuid, text, text) from public, anon;
revoke all on function public.delete_task_link(uuid, uuid) from public, anon;
grant execute on function public.add_task_link(uuid, text, text) to authenticated;
grant execute on function public.delete_task_link(uuid, uuid) to authenticated;
