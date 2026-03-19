create table if not exists batch_runs (
  id              uuid         primary key default gen_random_uuid(),
  batch_id        uuid         not null,
  run_index       integer      not null,
  success         boolean      not null,
  min_com_height  float        not null,
  steps_run       integer      not null,
  config          jsonb        not null,
  final_state     jsonb        not null,
  timestamp       timestamptz  not null default now()
);

create index idx_batch_runs_batch_id on batch_runs (batch_id);
