-- File attachments on a task. Metadata lives in task_attachments; bytes live in the private
-- `task-attachments` storage bucket under <project_id>/<task_id>/<attachment_id>.<ext>.
-- A row is registered through add_task_attachment (which validates role, size, type and the
-- per-task cap) BEFORE the client uploads, and the storage insert policy only accepts a path
-- that has a registered row owned by the caller.
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name varchar(255) not null check (char_length(trim(file_name)) between 1 and 255),
  mime_type varchar(127) not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_task_attachments_task on public.task_attachments(task_id, created_at);
alter table public.task_attachments enable row level security;
alter table public.task_attachments force row level security;
create policy task_attachments_member_read on public.task_attachments for select using (
  exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id and t.deleted_at is null and public.is_project_member(t.project_id)
  )
);

create or replace function public.add_task_attachment(
  p_task_id uuid, p_file_name text, p_mime_type text, p_size_bytes integer
) returns table (
  id uuid, task_id uuid, file_name varchar, mime_type varchar, size_bytes integer,
  storage_path text, created_by uuid, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  new_id uuid := gen_random_uuid();
  clean_name text := trim(regexp_replace(coalesce(p_file_name, ''), '[/\\[:cntrl:]]', '_', 'g'));
  ext text := lower(substring(clean_name from '\.([A-Za-z0-9]{1,10})$'));
  path text;
  row_out public.task_attachments%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found or not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if char_length(clean_name) not between 1 and 255 then raise exception 'INVALID_ATTACHMENT_NAME' using errcode = '22023'; end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then raise exception 'ATTACHMENT_TOO_LARGE' using errcode = '22023'; end if;
  if p_mime_type is null or p_mime_type not in (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
    'application/zip', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) then raise exception 'ATTACHMENT_TYPE_NOT_ALLOWED' using errcode = '22023'; end if;
  if (select count(*) from public.task_attachments a where a.task_id = parent_task.id) >= 10 then
    raise exception 'ATTACHMENT_LIMIT' using errcode = '22023';
  end if;
  path := parent_task.project_id::text || '/' || parent_task.id::text || '/' || new_id::text
    || case when ext is null then '' else '.' || ext end;
  insert into public.task_attachments (id, project_id, task_id, file_name, mime_type, size_bytes, storage_path, created_by)
  values (new_id, parent_task.project_id, parent_task.id, clean_name, p_mime_type, p_size_bytes, path, current_user_id)
  returning * into row_out;
  return query select row_out.id, row_out.task_id, row_out.file_name, row_out.mime_type, row_out.size_bytes,
    row_out.storage_path, row_out.created_by, row_out.created_at;
end;
$$;

-- Returns the storage path so the caller can remove the object; the row is gone either way.
create or replace function public.delete_task_attachment(p_task_id uuid, p_attachment_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  att public.task_attachments%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select a.* into att from public.task_attachments a
  join public.tasks t on t.id = a.task_id and t.deleted_at is null
  where a.id = p_attachment_id and a.task_id = p_task_id
  for update of a;
  if not found or not public.is_project_member(att.project_id) then raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(att.project_id) or (
    att.created_by is distinct from current_user_id and not exists (
      select 1 from public.memberships m
      where m.project_id = att.project_id and m.user_id = current_user_id and m.role in ('owner', 'admin')
    )
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.task_attachments where task_attachments.id = att.id;
  return att.storage_path;
end;
$$;

revoke all on function public.add_task_attachment(uuid, text, text, integer) from public, anon;
revoke all on function public.delete_task_attachment(uuid, uuid) from public, anon;
grant execute on function public.add_task_attachment(uuid, text, text, integer) to authenticated;
grant execute on function public.delete_task_attachment(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 10485760,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
    'application/zip', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

create policy task_attachments_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'task-attachments' and exists (
    select 1 from public.task_attachments a
    where a.storage_path = storage.objects.name and a.created_by = auth.uid()
  )
);
create policy task_attachments_download on storage.objects for select to authenticated using (
  bucket_id = 'task-attachments' and exists (
    select 1 from public.task_attachments a
    where a.storage_path = storage.objects.name and public.is_project_member(a.project_id)
  )
);
