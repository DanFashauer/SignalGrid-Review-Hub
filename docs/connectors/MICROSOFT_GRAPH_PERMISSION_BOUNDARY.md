# Microsoft Graph Permission Boundary

## Least-privilege read-only approach

The sandbox connector starts with placeholder read-only permissions only. Permission names are intentionally generic placeholders and must not be copied from a live tenant grant without review.

## MVP read-only permissions

- `Placeholder.Graph.User.ReadState.ReadOnly`
- `Placeholder.Graph.DeviceRegistration.ReadOnly`
- `Placeholder.Graph.IntuneManagedDevice.ReadOnly`
- `Placeholder.Graph.IntuneCompliance.ReadOnly`
- `Placeholder.Graph.ConfigurationProfileAssignment.ReadOnly`
- `Placeholder.Graph.ManagedAppInventory.ReadOnly`
- `Placeholder.Graph.AccessReviewContext.ReadOnly`
- `Placeholder.Graph.ServiceHealth.ReadOnly`

## Future approval-gated write permissions

Future write permissions are deferred and would require explicit owner approval, simulation first, audit evidence, and a reversible design where possible.

- `Placeholder.Graph.DeviceQuarantine.Write.ApprovalRequired`
- `Placeholder.Graph.PolicyPush.Write.ApprovalRequired`
- `Placeholder.Graph.SessionRevoke.Write.ApprovalRequired`
- `Placeholder.Graph.AccountDisable.Write.ApprovalRequired`
- `Placeholder.Graph.ConditionalAccessChange.Write.ApprovalRequired`
- `Placeholder.Graph.IntuneTemplateImport.Write.ApprovalRequired`
- `Placeholder.Graph.AppConfigDeployment.Write.ApprovalRequired`

## Explicitly forbidden MVP actions

The MVP must not import Intune templates, modify Intune policies, modify Conditional Access, lock/wipe/quarantine devices, disable accounts, revoke sessions, deploy apps/configurations, or perform autonomous production remediation.
