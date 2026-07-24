import Foundation

public enum DemoFixtures {
    public static let tenant = Tenant(
        id: "tenant_northwind",
        slug: "northwind-health",
        name: "Northwind Health (demo)",
        createdAt: "2026-07-13T15:00:00.000Z"
    )

    public static let principal = Principal(
        tenantId: tenant.id,
        principalType: "user",
        subjectId: "user_northwind_owner",
        role: .owner,
        keyReference: "sgk_demo…owner"
    )

    public static let keys: [DemoKey] = [
        DemoKey(
            tenant: tenant.id,
            role: .owner,
            token: "sgk_demo_northwind_owner",
            keyReference: "sgk_demo_northwind_owner"
        ),
        DemoKey(
            tenant: tenant.id,
            role: .operator,
            token: "sgk_demo_northwind_operator",
            keyReference: "sgk_demo_northwind_operator"
        ),
        DemoKey(
            tenant: tenant.id,
            role: .auditor,
            token: "sgk_demo_northwind_auditor",
            keyReference: "sgk_demo_northwind_auditor"
        )
    ]

    public static let trustScenarios: [TrustScenario] = [
        TrustScenario(
            id: "healthy",
            title: "Trusted clinical session",
            subtitle: "Enabled nurse · compliant shared iPad · fresh posture",
            identityRef: "nurse.compliant",
            deviceRef: "ipad-ward-01",
            workflowKey: "clinical-session",
            expectedOutcome: .allow
        ),
        TrustScenario(
            id: "noncompliant",
            title: "Non-compliant device",
            subtitle: "Managed device fails compliance for a clinical workflow",
            identityRef: "nurse.noncompliant",
            deviceRef: "ipad-ward-02",
            workflowKey: "clinical-session",
            expectedOutcome: .restrict
        ),
        TrustScenario(
            id: "stale",
            title: "Stale posture",
            subtitle: "Posture evidence is outside the accepted freshness window",
            identityRef: "nurse.stale",
            deviceRef: "ipad-ward-03",
            workflowKey: "clinical-session",
            expectedOutcome: .stepUp
        ),
        TrustScenario(
            id: "unmanaged",
            title: "Unmanaged personal device",
            subtitle: "Personal iPad is not under the required management authority",
            identityRef: "tech.unmanaged",
            deviceRef: "ipad-byod-01",
            workflowKey: "clinical-session",
            expectedOutcome: .restrict
        ),
        TrustScenario(
            id: "disabled",
            title: "Disabled identity",
            subtitle: "Identity is disabled even though the shared iPad is compliant",
            identityRef: "nurse.disabled",
            deviceRef: "ipad-ward-04",
            workflowKey: "clinical-session",
            expectedOutcome: .deny
        ),
        TrustScenario(
            id: "missing",
            title: "Missing posture",
            subtitle: "No current endpoint posture is available",
            identityRef: "nurse.nosync",
            deviceRef: "ipad-ward-05",
            workflowKey: "clinical-session",
            expectedOutcome: .restrict
        ),
        TrustScenario(
            id: "baseline",
            title: "Security baseline drift",
            subtitle: "Device is managed and compliant but its hardening baseline drifted",
            identityRef: "nurse.baseline_drift",
            deviceRef: "ipad-ward-06",
            workflowKey: "clinical-session",
            expectedOutcome: .stepUp
        ),
        TrustScenario(
            id: "badge-removed",
            title: "Badge withdrawn",
            subtitle: "Assigned credential was removed from the reader case",
            identityRef: "nurse.badge_removed",
            deviceRef: "ipad-badge-01",
            workflowKey: "clinical-session",
            expectedOutcome: .restrict
        ),
        TrustScenario(
            id: "badge-forced",
            title: "Forced badge removal",
            subtitle: "Reader-case tamper signal requires a fail-closed decision",
            identityRef: "nurse.badge_forced",
            deviceRef: "ipad-badge-02",
            workflowKey: "clinical-session",
            expectedOutcome: .deny
        ),
        TrustScenario(
            id: "custody-overdue",
            title: "Overdue device return",
            subtitle: "Healthy posture but the loaner device custody state is overdue",
            identityRef: "nurse.overdue",
            deviceRef: "ipad-loan-01",
            workflowKey: "clinical-session",
            expectedOutcome: .restrict
        )
    ]

    public static let connectors: [Connector] = [
        Connector(
            id: "conn_northwind_ms",
            tenantId: tenant.id,
            kind: "microsoft-entra-intune",
            mode: "fixture",
            ingestionMode: nil,
            permissionScope: "DeviceManagementManagedDevices.Read.All (documented fixture scope)",
            credentialRef: "keyvault://placeholder/microsoft-connector",
            status: .healthy,
            lastSyncAt: "2026-07-13T14:55:00.000Z"
        ),
        Connector(
            id: "conn_northwind_dockbridge",
            tenantId: tenant.id,
            kind: "dockbridge-custody",
            mode: "fixture",
            ingestionMode: "app_in_dock",
            permissionScope: "read-only custody fixture",
            credentialRef: "keyvault://placeholder/dockbridge",
            status: .healthy,
            lastSyncAt: "2026-07-13T14:54:30.000Z"
        ),
        Connector(
            id: "conn_northwind_smartdock",
            tenantId: tenant.id,
            kind: "dockbridge-custody",
            mode: "fixture",
            ingestionMode: "embedded_smartdock",
            permissionScope: "read-only smart-dock fixture",
            credentialRef: "keyvault://placeholder/smartdock",
            status: .degraded,
            lastSyncAt: "2026-07-13T14:42:00.000Z"
        )
    ]

    public static let policies: [Policy] = [
        Policy(
            id: "pol_tenant_northwind_shared_device",
            tenantId: tenant.id,
            key: "shared-device-baseline",
            name: "Shared-device baseline access policy",
            description: "Identity, device posture, freshness, custody, badge binding, and workflow-risk policy.",
            workflowPattern: "*",
            activeVersionId: "pol_tenant_northwind_shared_device_v1"
        )
    ]

    public static let policyVersions: [PolicyVersion] = [
        PolicyVersion(
            id: "pol_tenant_northwind_shared_device_v1",
            tenantId: tenant.id,
            policyId: "pol_tenant_northwind_shared_device",
            version: 1,
            status: .active,
            rules: [
                PolicyRule(
                    id: "identity-disabled",
                    description: "Deny a disabled identity.",
                    match: [.object(["field": .string("identityEnabled"), "equals": .bool(false)])],
                    outcome: .deny,
                    reasonCode: "IDENTITY_DISABLED",
                    severity: .critical
                ),
                PolicyRule(
                    id: "device-noncompliant",
                    description: "Restrict a non-compliant managed device.",
                    match: [.object(["field": .string("deviceCompliance"), "in": .array([.string("non_compliant")])])],
                    outcome: .restrict,
                    reasonCode: "DEVICE_NONCOMPLIANT",
                    severity: .high
                ),
                PolicyRule(
                    id: "posture-stale",
                    description: "Require step-up when posture is stale.",
                    match: [.object(["field": .string("postureFreshness"), "in": .array([.string("stale")])])],
                    outcome: .stepUp,
                    reasonCode: "POSTURE_STALE",
                    severity: .medium
                )
            ],
            createdAt: "2026-07-13T15:00:00.000Z",
            digest: "sha256:demo-policy-v1"
        ),
        PolicyVersion(
            id: "pol_tenant_northwind_shared_device_v2",
            tenantId: tenant.id,
            policyId: "pol_tenant_northwind_shared_device",
            version: 2,
            status: .draft,
            rules: [],
            createdAt: "2026-07-13T15:00:00.000Z",
            digest: "sha256:demo-policy-v2-draft"
        )
    ]

    public static let integrations: [AppIntegration] = [
        AppIntegration(
            id: "emr-chart",
            name: "EMR / chart",
            category: "Clinical record",
            vertical: .healthcare,
            workflowKey: "clinical-session",
            actions: [
                AppAction(key: "chart.open", label: "Open patient chart", riskTier: .elevated, sensitive: false, gatedByStepUp: true),
                AppAction(key: "results.view", label: "View lab / imaging results", riskTier: .elevated, sensitive: false, gatedByStepUp: true),
                AppAction(key: "note.document", label: "Document a note", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "order.place", label: "Place / verify a medication order", riskTier: .critical, sensitive: true, gatedByStepUp: true),
                AppAction(key: "discharge.release", label: "Release discharge", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "bcma",
            name: "BCMA",
            category: "Medication administration",
            vertical: .healthcare,
            workflowKey: "med-admin",
            actions: [
                AppAction(key: "patient.scan", label: "Scan patient wristband", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "med.scan", label: "Scan medication", riskTier: .elevated, sensitive: false, gatedByStepUp: true),
                AppAction(key: "controlled.administer", label: "Administer controlled substance", riskTier: .critical, sensitive: true, gatedByStepUp: true),
                AppAction(key: "dose.override", label: "Override a dose warning", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "wms",
            name: "WMS / WES",
            category: "Warehouse execution",
            vertical: .warehouse,
            workflowKey: "pick-pack",
            actions: [
                AppAction(key: "task.accept", label: "Accept a pick task", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "pick.confirm", label: "Confirm a pick", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "inventory.adjust", label: "Adjust inventory", riskTier: .elevated, sensitive: false, gatedByStepUp: true),
                AppAction(key: "highvalue.release", label: "Release a high-value / hazmat pick", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "mes-scada",
            name: "MES / SCADA-HMI",
            category: "Line operations",
            vertical: .industrial,
            workflowKey: "line-ops",
            actions: [
                AppAction(key: "line.status", label: "View line status", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "event.ack", label: "Acknowledge an event", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "setpoint.change", label: "Change a setpoint", riskTier: .critical, sensitive: true, gatedByStepUp: true),
                AppAction(key: "line.startstop", label: "Start / stop a line", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "tms-dispatch",
            name: "TMS / dispatch",
            category: "Transportation management",
            vertical: .globalFleet,
            workflowKey: "field-session",
            actions: [
                AppAction(key: "manifest.view", label: "View manifest", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "load.accept", label: "Accept a load", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "crossregion.checkout", label: "Cross-region checkout", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "pos",
            name: "POS",
            category: "Point of sale",
            vertical: .retail,
            workflowKey: "pos-session",
            actions: [
                AppAction(key: "price.lookup", label: "Look up a price", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "sale.ring", label: "Ring a sale", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "refund.void", label: "Manager void / refund", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        ),
        AppIntegration(
            id: "network-config",
            name: "Network config",
            category: "Network control",
            vertical: .dataCenter,
            workflowKey: "network-change",
            actions: [
                AppAction(key: "config.view", label: "View running config", riskTier: .standard, sensitive: false, gatedByStepUp: false),
                AppAction(key: "diff.stage", label: "Stage a config diff", riskTier: .elevated, sensitive: false, gatedByStepUp: true),
                AppAction(key: "config.push", label: "Push config to a core device", riskTier: .critical, sensitive: true, gatedByStepUp: true)
            ]
        )
    ]
}
