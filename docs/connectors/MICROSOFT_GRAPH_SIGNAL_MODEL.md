# Microsoft Graph Signal Model

## Normalized SignalGrid fields

Microsoft Graph, Entra, and Intune-style observations normalize into these canonical SignalGrid fields:

| Field                       | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `sourceSystem`              | Public-safe source label such as `microsoft_graph_sandbox_fixture`.           |
| `subjectId`                 | Synthetic user or workload subject identifier.                                |
| `deviceId`                  | Synthetic device identifier when device context exists.                       |
| `identityStatus`            | Identity state such as `enabled`, `disabled`, `unknown`, or `not_applicable`. |
| `userRisk`                  | User risk summary such as `low`, `medium`, `high`, or `unknown`.              |
| `deviceRegistrationState`   | Entra device registration posture.                                            |
| `deviceComplianceState`     | Intune-style compliance posture.                                              |
| `deviceManagementState`     | Managed, unmanaged, inactive, retired, or unknown state.                      |
| `deviceLastSeenAt`          | Fixture timestamp for last device observation.                                |
| `postureFreshness`          | Freshness bucket such as `fresh`, `stale`, `expired`, or `unknown`.           |
| `configurationProfileState` | Configuration profile assignment or drift status.                             |
| `policyAssignmentState`     | Policy assignment coverage status.                                            |
| `managedAppState`           | Managed application inventory/status summary where safe.                      |
| `accessReviewState`         | Access review or IGA context where available.                                 |
| `permissionHealth`          | Graph permission health such as `healthy`, `degraded`, or `failed`.           |
| `graphApiHealth`            | Graph API health such as `available`, `degraded`, or `unavailable`.           |
| `correlationId`             | Synthetic correlation identifier for audit and proof output.                  |
| `observedAt`                | Fixture observation timestamp.                                                |
| `fixtureVersion`            | Deterministic fixture schema version.                                         |

## Confidence handling

Missing, malformed, or ambiguous high-risk input must not produce an unsafe allow decision. Unknown identity, compliance, permission, or Graph API health should reduce confidence and route review or integration-health events instead of bypassing approval gates.
