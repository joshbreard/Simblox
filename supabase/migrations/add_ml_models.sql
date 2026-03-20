create table if not exists project_models (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text not null,
  pytorch_script text,
  model_weights jsonb,
  created_at timestamptz default now(),
  last_trained_at timestamptz
);

create table if not exists model_training_batches (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references project_models(id) on delete cascade,
  batch_id text not null,
  added_at timestamptz default now(),
  trained boolean not null default false,
  run_count int,
  batch_summary text
);
