create type public.notification_type as enum ('task_assigned', 'task_unassigned', 'mentioned', 'status_changed', 'due_soon', 'digest_ready');
create type public.notification_category as enum ('assignment', 'mention', 'status_change', 'due_soon', 'digest');
alter table public.users add column email_undeliverable_at timestamptz;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  type public.notification_type not null,
  actor_id uuid references public.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  email_status text not null default 'pending' check (email_status in ('pending', 'skipped', 'sent')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create index idx_notifications_user_recent on public.notifications(user_id, created_at desc);
create unique index notifications_due_soon_once on public.notifications(task_id, type, user_id, (payload ->> 'dueDate')) where type = 'due_soon';

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  window_start timestamptz not null,
  send_after timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique(user_id, window_start)
);
create index idx_notification_queue_due on public.notification_queue(send_after) where sent_at is null;
create table public.notification_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  category public.notification_category not null,
  email boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id, category)
);
create trigger notification_preferences_updated_at before update on public.notification_preferences for each row execute function public.set_updated_at();
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.notification_queue enable row level security;
alter table public.notification_queue force row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
create policy notifications_self_read on public.notifications for select to authenticated
  using (notifications.user_id = auth.uid() and public.is_project_member(notifications.project_id));
create policy notification_preferences_self on public.notification_preferences for all to authenticated
  using (notification_preferences.user_id = auth.uid()) with check (notification_preferences.user_id = auth.uid());
alter publication supabase_realtime add table public.notifications;

create function public.notification_category_for(p_type public.notification_type)
returns public.notification_category language sql immutable set search_path = public as $$
  select case p_type
    when 'task_assigned' then 'assignment'::public.notification_category
    when 'task_unassigned' then 'assignment'::public.notification_category
    when 'mentioned' then 'mention'::public.notification_category
    when 'status_changed' then 'status_change'::public.notification_category
    when 'due_soon' then 'due_soon'::public.notification_category
    when 'digest_ready' then 'digest'::public.notification_category end;
$$;

create function public.enqueue_notifications(
  p_type public.notification_type, p_project_id uuid, p_task_id uuid,
  p_actor_id uuid, p_recipient_ids uuid[], p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  recipient_id uuid;
  target_category public.notification_category := public.notification_category_for(p_type);
  email_allowed boolean;
  inserted_id uuid;
  batch_start timestamptz := date_bin(interval '5 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.deleted_at is null) then return; end if;
  if p_task_id is not null and not exists (select 1 from public.tasks t where t.id = p_task_id and t.project_id = p_project_id and t.deleted_at is null) then return; end if;
  for recipient_id in
    select distinct m.user_id from public.memberships m join public.users u on u.id = m.user_id
    where m.project_id = p_project_id and m.user_id = any(p_recipient_ids)
      and m.user_id is distinct from p_actor_id and u.deleted_at is null
  loop
    select coalesce((select np.email from public.notification_preferences np where np.user_id = recipient_id and np.category = target_category), true)
      and u.email_undeliverable_at is null into email_allowed from public.users u where u.id = recipient_id;
    inserted_id := null;
    insert into public.notifications(user_id, project_id, task_id, type, actor_id, payload, email_status)
      values(recipient_id, p_project_id, p_task_id, p_type, p_actor_id, coalesce(p_payload, '{}'::jsonb), case when email_allowed then 'pending' else 'skipped' end)
      on conflict do nothing returning notifications.id into inserted_id;
    if inserted_id is not null and email_allowed then
      insert into public.notification_queue(user_id, window_start, send_after)
      values(recipient_id, batch_start, batch_start + interval '5 minutes')
      on conflict on constraint notification_queue_user_id_window_start_key do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function public.enqueue_notifications(public.notification_type, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
