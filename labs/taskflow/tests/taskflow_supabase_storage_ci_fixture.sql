\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated LOGIN PASSWORD 'taskflow-ci-only';
CREATE ROLE taskflow_migrator NOLOGIN;
CREATE ROLE taskflow_runtime NOLOGIN;

CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
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
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, taskflow_migrator;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

CREATE TABLE taskflow.member (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL
);
ALTER TABLE taskflow.member OWNER TO taskflow_migrator;
GRANT SELECT ON taskflow.member TO taskflow_migrator;

INSERT INTO taskflow.member(workspace_id, user_id, role) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'member');
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('legacy-bucket', 'legacy-bucket', false, 104857600, NULL);
INSERT INTO storage.objects(bucket_id, name, owner_id)
VALUES ('legacy-bucket', 'legacy-object', '11111111-1111-4111-8111-111111111111');
