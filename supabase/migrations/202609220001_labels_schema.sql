create table public.labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name citext not null check (char_length(trim(name::text)) between 1 and 50),
  color varchar(7) not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create table public.task_labels (
  task_id uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);
create index idx_labels_project on public.labels(project_id);
create index idx_task_labels_label on public.task_labels(label_id);
alter table public.labels enable row level security;
alter table public.labels force row level security;
alter table public.task_labels enable row level security;
alter table public.task_labels force row level security;
create policy labels_member_read on public.labels for select using (public.is_project_member(labels.project_id));
create policy task_labels_member_read on public.task_labels for select using (
  exists (select 1 from public.tasks where tasks.id = task_labels.task_id and tasks.deleted_at is null and public.is_project_member(tasks.project_id))
);
