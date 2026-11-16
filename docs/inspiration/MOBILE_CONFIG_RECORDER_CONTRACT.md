# Mobile post-configuration recorder — reference contract (intake row 33)

<!--
  PROVENANCE / BOUNDARY PREAMBLE — added at filing time (intake ledger row 33).

  This file preserves, VERBATIM, the post-configuration recorder JSON Schema
  and the PostgreSQL data model from the owner-compiled Mobile App & Managed
  Configuration Master Catalog bundle (2026-08-01). One .md carrier is
  deliberate: the boundary text below must be inseparable from the artifacts.

  BINDING BOUNDARIES:

  - NOTHING in this repository consumes these contracts. They are a reference
    SHAPE for a future per-app configuration-receipt capability, not a shipped
    recorder. No table here may be stood up in this tree: the SQL's
    tenant-scoped recorder tables describe a PRIVATE data plane, and this
    public repository is fixture-backed and database-free by law.
  - `rollback.status` values `unproven` / `not_applicable` are honest recorded
    states. Any future consumer must fail-closed gate on them — recording an
    unproven rollback NEVER makes a deploy permissible (the
    provisioning-teardown `deployReady` and `@workspace/iac` apply doctrine).
  - `evidence.recorderVersion` DEFERS to normalization-version stamping, which
    is BUILT (docs/BUILD_BACKLOG.md row 27a;
    `scripts/generate-core-normalization-version.mjs`) and is the canonical
    fabric version-stamping surface. Any future recorder aligns this field to
    it, not the reverse. (This bullet posed the build as "queued … if that
    build lands first" until 2026-09-06.)
  - Wall-clock fields (`capturedAt`, `assignedAt`, `receivedAt`, `verifiedAt`)
    are SUPPLIED evidence, never read from a clock inside a decision path
    (the `gradeSetupCompletion` firstUserSessionAt precedent).
  - The catalog's "official Intune protected partner app" term is Microsoft's;
    it never means a SignalGrid partnership, and no dependency is taken on any
    vendor named in these artifacts.

  Original upload SHA-256:
    recorder schema 571bde90bf034e4abba6eb7e3e39bce97ab6c1389686f3f030a8634ab2409a7b
    sql model       563aa7668b8cae0245ae1a60460a1c23e4e0bd527cf66549a5a17b042ee02b73
-->

## Post-configuration recorder JSON Schema (verbatim)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://signalgrid.example/schemas/mobile-config-recorder.schema.json",
  "title": "SignalGrid Mobile Post-Configuration Recording",
  "type": "object",
  "required": [
    "recordingId",
    "capturedAt",
    "app",
    "deployment",
    "schema",
    "configurationSnapshot",
    "validation",
    "rollback",
    "evidence"
  ],
  "properties": {
    "recordingId": {
      "type": "string"
    },
    "capturedAt": {
      "type": "string",
      "format": "date-time"
    },
    "environment": {
      "enum": [
        "lab",
        "demo",
        "dev",
        "alpha",
        "beta",
        "staging",
        "pilot",
        "production"
      ]
    },
    "tenantReferenceHash": {
      "type": "string"
    },
    "app": {
      "type": "object",
      "required": [
        "catalogAppId",
        "canonicalName",
        "platform",
        "identifier",
        "version"
      ],
      "properties": {
        "catalogAppId": {
          "type": "string"
        },
        "canonicalName": {
          "type": "string"
        },
        "platform": {
          "type": "string"
        },
        "identifier": {
          "type": "string"
        },
        "version": {
          "type": "string"
        },
        "installChannel": {
          "type": "string"
        },
        "managedState": {
          "enum": [
            "managed",
            "unmanaged",
            "unknown"
          ]
        }
      },
      "additionalProperties": false
    },
    "deployment": {
      "type": "object",
      "required": [
        "channel",
        "policyReference",
        "assignmentReference",
        "configurationVersion"
      ],
      "properties": {
        "channel": {
          "enum": [
            "apple_mdm",
            "android_enterprise",
            "intune_mam",
            "jamf",
            "workspace_one",
            "fleet",
            "oemconfig",
            "vendor_console",
            "host_backend",
            "signalgrid_policy"
          ]
        },
        "policyReference": {
          "type": "string"
        },
        "assignmentReference": {
          "type": "string"
        },
        "configurationVersion": {
          "type": "string"
        },
        "assignedAt": {
          "type": "string",
          "format": "date-time"
        },
        "receivedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "additionalProperties": false
    },
    "schema": {
      "type": "object",
      "required": [
        "schemaId",
        "format",
        "sourceUrl",
        "contentHash"
      ],
      "properties": {
        "schemaId": {
          "type": "string"
        },
        "format": {
          "enum": [
            "plist",
            "xml",
            "json",
            "android_restrictions",
            "mobileconfig",
            "manifest",
            "environment",
            "vendor_export"
          ]
        },
        "sourceUrl": {
          "type": "string"
        },
        "contentHash": {
          "type": "string"
        },
        "minimumAppVersion": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "configurationSnapshot": {
      "type": "object",
      "required": [
        "redactedValues",
        "valueHash"
      ],
      "properties": {
        "redactedValues": {
          "type": "object"
        },
        "valueHash": {
          "type": "string"
        },
        "sourceExportHash": {
          "type": "string"
        },
        "secretFieldsRemoved": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "checkId",
          "expected",
          "result",
          "verifiedAt"
        ],
        "properties": {
          "checkId": {
            "type": "string"
          },
          "expected": {},
          "observedRedacted": {},
          "result": {
            "enum": [
              "pass",
              "fail",
              "limited",
              "not_run"
            ]
          },
          "reason": {
            "type": "string"
          },
          "verifiedAt": {
            "type": "string",
            "format": "date-time"
          },
          "evidenceReference": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "rollback": {
      "type": "object",
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "enum": [
            "proven",
            "simulated",
            "unproven",
            "not_applicable"
          ]
        },
        "priorSnapshotId": {
          "type": "string"
        },
        "steps": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "approvalState": {
          "enum": [
            "not_required",
            "pending",
            "approved",
            "denied"
          ]
        },
        "lastTestedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "additionalProperties": false
    },
    "evidence": {
      "type": "object",
      "required": [
        "recorderVersion",
        "sourceReferences",
        "digest"
      ],
      "properties": {
        "recorderVersion": {
          "type": "string"
        },
        "sourceReferences": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "digest": {
          "type": "string"
        },
        "auditEventReference": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}```

## PostgreSQL data model (verbatim)

```sql
-- SignalGrid mobile app catalog and post-configuration recorder
-- Public catalog tables contain metadata only. Customer deployment records belong
-- in a tenant-isolated private data plane with encryption, retention, and authorization.

create table mobile_apps (
  app_id text primary key,
  canonical_name text not null,
  vendor_name text not null,
  record_class text not null,
  industry text not null,
  workflow_use_case text,
  status text not null,
  priority text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mobile_source_observations (
  source_observation_id uuid primary key,
  source_url text not null,
  source_type text not null,
  retrieved_at timestamptz not null,
  etag_or_hash text not null,
  parser_version text not null,
  confidence text not null,
  redistribution_boundary text,
  raw_reference text
);

create table mobile_app_aliases (
  alias_id uuid primary key,
  app_id text not null references mobile_apps(app_id),
  alias_name text not null,
  valid_from timestamptz,
  valid_to timestamptz,
  source_observation_id uuid references mobile_source_observations(source_observation_id)
);

create table mobile_platform_identifiers (
  identifier_id uuid primary key,
  app_id text not null references mobile_apps(app_id),
  platform text not null,
  identifier text not null,
  store_url text,
  observed_version text,
  observed_at timestamptz not null,
  source_observation_id uuid not null references mobile_source_observations(source_observation_id)
);

create table mobile_config_schemas (
  schema_id uuid primary key,
  app_id text not null references mobile_apps(app_id),
  platform text not null,
  delivery_channel text not null,
  format text not null,
  schema_version text not null,
  minimum_app_version text,
  source_url text not null,
  content_hash text not null,
  source_observation_id uuid not null references mobile_source_observations(source_observation_id),
  status text not null,
  unique(app_id, platform, delivery_channel, schema_version)
);

create table mobile_config_keys (
  config_key_id uuid primary key,
  schema_id uuid not null references mobile_config_schemas(schema_id),
  key_name text not null,
  value_type text not null,
  default_value_redacted jsonb,
  allowed_values jsonb,
  required boolean not null default false,
  sensitive boolean not null default false,
  deprecated boolean not null default false,
  description text,
  unique(schema_id, key_name)
);

create table mobile_workflow_mappings (
  mapping_id uuid primary key,
  app_id text not null references mobile_apps(app_id),
  workflow_key text not null,
  action_key text not null,
  risk_tier text not null,
  sensitive boolean not null,
  step_up_gated boolean not null,
  route_owner text,
  policy_version_ref text not null,
  active boolean not null default false
);

create table mobile_catalog_scan_runs (
  run_id uuid primary key,
  started_at timestamptz not null,
  completed_at timestamptz,
  tool_version text not null,
  source_set jsonb not null,
  status text not null,
  error_summary text
);

create table mobile_repo_findings (
  finding_id uuid primary key,
  run_id uuid not null references mobile_catalog_scan_runs(run_id),
  repository text not null,
  path text not null,
  artifact_type text not null,
  source_hash text not null,
  identifiers jsonb not null,
  config_keys jsonb not null,
  secret_shaped_keys jsonb not null,
  errors jsonb not null
);

create table mobile_catalog_changes (
  change_id uuid primary key,
  app_id text references mobile_apps(app_id),
  field_name text not null,
  before_value jsonb,
  after_value jsonb,
  source_observation_id uuid not null references mobile_source_observations(source_observation_id),
  review_state text not null,
  reviewed_by text,
  reviewed_at timestamptz
);

-- Private tenant-isolated recorder tables.
create table mobile_deployment_recordings (
  recording_id uuid primary key,
  tenant_id uuid not null,
  app_id text not null references mobile_apps(app_id),
  app_version text not null,
  platform_identifier text not null,
  policy_reference text not null,
  assignment_reference text not null,
  delivery_channel text not null,
  configuration_version text not null,
  captured_at timestamptz not null,
  created_by text not null
);

create table mobile_config_snapshots (
  snapshot_id uuid primary key,
  tenant_id uuid not null,
  recording_id uuid not null references mobile_deployment_recordings(recording_id),
  schema_id uuid not null references mobile_config_schemas(schema_id),
  normalized_values_redacted jsonb not null,
  value_hash text not null,
  source_export_hash text,
  secret_fields_removed jsonb not null,
  captured_at timestamptz not null
);

create table mobile_validation_results (
  validation_id uuid primary key,
  tenant_id uuid not null,
  recording_id uuid not null references mobile_deployment_recordings(recording_id),
  check_id text not null,
  expected_redacted jsonb,
  observed_redacted jsonb,
  result text not null,
  reason text,
  evidence_reference text,
  verified_at timestamptz not null
);

create table mobile_rollback_plans (
  rollback_plan_id uuid primary key,
  tenant_id uuid not null,
  recording_id uuid not null references mobile_deployment_recordings(recording_id),
  prior_snapshot_id uuid,
  steps jsonb not null,
  approval_state text not null,
  simulation_result text,
  last_tested_at timestamptz,
  status text not null
);

create index on mobile_platform_identifiers(app_id, platform);
create index on mobile_config_schemas(app_id, platform, delivery_channel);
create index on mobile_config_keys(schema_id, key_name);
create index on mobile_workflow_mappings(app_id, workflow_key);
create index on mobile_deployment_recordings(tenant_id, app_id, captured_at desc);
```
