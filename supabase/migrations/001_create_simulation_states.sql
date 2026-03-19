create table if not exists simulation_states (
  id         uuid         primary key default gen_random_uuid(),
  run_id     uuid         not null,
  step       integer      not null,
  state      jsonb        not null,
  timestamp  timestamptz  not null default now()
);

create index idx_simulation_states_run_id on simulation_states (run_id);
