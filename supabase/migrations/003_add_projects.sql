create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz default now()
);

alter table batch_runs
  add column if not exists project_id uuid references projects(id);

create index if not exists batch_runs_project_id_idx on batch_runs(project_id);
