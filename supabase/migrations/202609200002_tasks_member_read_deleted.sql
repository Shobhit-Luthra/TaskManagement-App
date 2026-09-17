-- Additive to the existing active-task policy, limited to the retention period.
create policy tasks_member_read_deleted on public.tasks for select using (
  tasks.deleted_at is not null
  and tasks.deleted_at > now() - interval '30 days'
  and public.is_project_member(tasks.project_id)
);
