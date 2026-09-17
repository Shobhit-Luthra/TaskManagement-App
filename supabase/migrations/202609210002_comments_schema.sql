create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  mentioned_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_comments_task on public.comments(task_id, created_at) where deleted_at is null;
create index idx_comments_mentions on public.comments using gin (mentioned_user_ids) where deleted_at is null;
create trigger comments_updated_at before update on public.comments
for each row execute function public.set_updated_at();
alter table public.comments enable row level security;
alter table public.comments force row level security;
create policy comments_member_read on public.comments for select
using (comments.deleted_at is null and public.is_project_member(comments.project_id));
