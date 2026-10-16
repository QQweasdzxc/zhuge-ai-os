-- Persist the existing AI engineering controls without creating a parallel
-- task model. Native TaskFlow Project and Issue remain the authority.
CREATE TABLE zhuge_ai_project_setting (
    workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT false,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, project_id)
);

CREATE TABLE zhuge_ai_issue_setting (
    workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT false,
    engineer text NOT NULL DEFAULT 'co' CHECK (engineer IN ('co', 'gem')),
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, issue_id)
);

REVOKE ALL ON TABLE zhuge_ai_project_setting, zhuge_ai_issue_setting FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE zhuge_ai_project_setting, zhuge_ai_issue_setting TO taskflow_runtime;
GRANT UPDATE (enabled, updated_by, updated_at) ON TABLE zhuge_ai_project_setting TO taskflow_runtime;
GRANT UPDATE (enabled, engineer, updated_by, updated_at) ON TABLE zhuge_ai_issue_setting TO taskflow_runtime;
