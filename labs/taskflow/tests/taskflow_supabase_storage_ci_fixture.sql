\set ON_ERROR_STOP on

-- Synthetic, isolated stand-in for the live Supabase permission boundary.
-- The service's postgres superuser only provisions this fixture. Bootstrap,
-- helper installation, and managed Storage policy setup then use separate
-- restricted logins, mirroring the hosted execution paths.
CREATE ROLE anon LOGIN NOINHERIT PASSWORD 'taskflow-ci-anon';
CREATE ROLE authenticated LOGIN NOINHERIT PASSWORD 'taskflow-ci-authenticated';
CREATE ROLE taskflow_migrator LOGIN NOINHERIT PASSWORD 'taskflow-ci-migrator';
CREATE ROLE taskflow_runtime NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT;
CREATE ROLE multica_lab_runtime NOLOGIN NOINHERIT;
CREATE ROLE supabase_storage_admin LOGIN NOINHERIT PASSWORD 'taskflow-ci-storage-admin';
CREATE ROLE taskflow_bootstrap LOGIN NOINHERIT PASSWORD 'taskflow-ci-bootstrap';
GRANT CREATE ON DATABASE postgres TO taskflow_bootstrap;

CREATE SCHEMA auth AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id text PRIMARY KEY DEFAULT md5(random()::text),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner_id text
);
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
-- Mirrors the existing hosted postgres role's read/write baseline without
-- managed-schema CREATE. This restricted CI login is not an application role.
GRANT USAGE ON SCHEMA storage TO taskflow_bootstrap;
GRANT SELECT ON storage.buckets TO authenticated, anon;
GRANT SELECT ON storage.buckets TO taskflow_bootstrap;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO taskflow_bootstrap;
GRANT SELECT ON storage.objects TO anon;

CREATE TABLE taskflow.member (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL
);
ALTER TABLE taskflow.member OWNER TO taskflow_migrator;
GRANT USAGE ON SCHEMA taskflow TO taskflow_migrator;
GRANT SELECT ON taskflow.member TO taskflow_migrator;

INSERT INTO taskflow.member(workspace_id, user_id, role) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'member');
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('legacy-bucket', 'legacy-bucket', false, 104857600, NULL);
INSERT INTO storage.objects(bucket_id, name, owner_id)
VALUES ('legacy-bucket', 'legacy-object', '11111111-1111-4111-8111-111111111111');
