-- Zhuge AI OS / Sprint 2 Knowledge Integration
-- Scope: explicit Upload + explicit Google Drive file source metadata.
-- No Drive folder scan, background sync, embedding, vector search, or RAG.

begin;

alter table public.knowledge_sources
  add column if not exists source_provider text not null default 'upload',
  add column if not exists external_file_id text,
  add column if not exists source_modified_at timestamptz,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists knowledge_version text not null default 'v1.0',
  add column if not exists indexed_at timestamptz;

update public.knowledge_sources
set source_provider = case
  when lower(coalesce(source_provider, '')) in ('google_drive', 'drive') then 'google_drive'
  else 'upload'
end
where source_provider is null or source_provider not in ('upload', 'google_drive');

alter table public.knowledge_sources
  alter column source_provider set default 'upload',
  alter column source_provider set not null,
  alter column knowledge_version set default 'v1.0',
  alter column knowledge_version set not null;

alter table public.knowledge_sources
  drop constraint if exists knowledge_sources_source_provider_check;

alter table public.knowledge_sources
  add constraint knowledge_sources_source_provider_check
  check (source_provider in ('upload', 'google_drive'));

create unique index if not exists knowledge_sources_user_provider_external_uidx
  on public.knowledge_sources(user_uuid, source_provider, external_file_id)
  where deleted_at is null and external_file_id is not null;

create index if not exists knowledge_sources_user_provider_idx
  on public.knowledge_sources(user_uuid, source_provider, updated_at desc);

comment on column public.knowledge_sources.source_provider is
  'Sprint 2 source boundary: upload or an explicitly selected google_drive file.';
comment on column public.knowledge_sources.external_file_id is
  'Provider-native file identifier. For Google Drive this is the selected fileId; never a folder id.';
comment on column public.knowledge_sources.source_modified_at is
  'Last modified timestamp observed at the provider during ingestion or refresh.';
comment on column public.knowledge_sources.source_metadata is
  'Non-secret provider metadata. Must not contain OAuth tokens or full document content.';
comment on column public.knowledge_sources.knowledge_version is
  'Version of the normalized Knowledge representation, independent from source_version.';
comment on column public.knowledge_sources.indexed_at is
  'Last successful parser/Knowledge indexing time.';

commit;