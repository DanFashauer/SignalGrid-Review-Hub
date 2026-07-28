import UIKit

/// Main workspace/home screen view controller shown during active session
/// Displays user persona, managed apps, and dashboard widgets based on MDM configuration
final class ActiveSessionViewController: UIViewController {
    
    // MARK: - Properties
    
    private var session: SessionData? {
        SessionStateManager.shared.currentSession
    }
    
    private var displayTimer: Timer?
    private var sessionTimer: Timer?

    // Simulator demo auto-open latches: viewDidAppear fires on every reappearance
    // (e.g. after dismissing the managed browser), so without a once-per-session
    // guard each return would schedule another present and the demo would reopen
    // indefinitely, never returning to the session home.
    private var didAutoOpenApp = false
    private var didAutoOpenAssist = false

    // MARK: - UI Components
    
    private lazy var scrollView: UIScrollView = {
        let scrollView = UIScrollView()
        scrollView.showsVerticalScrollIndicator = true
        scrollView.alwaysBounceVertical = true
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        return scrollView
    }()
    
    private lazy var contentView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    // MARK: - User Profile Header
    
    private lazy var profileHeaderView: UIView = {
        let view = UIView()
        view.backgroundColor = SG.primary
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var avatarView: UIView = {
        let view = UIView()
        view.backgroundColor = .white.withAlphaComponent(0.2)
        view.layer.cornerRadius = 40
        view.layer.borderWidth = 2
        view.layer.borderColor = UIColor.white.cgColor
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var avatarLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textColor = .white
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var userNameLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var userRoleLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        label.textColor = .white.withAlphaComponent(0.9)
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var departmentLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        label.textColor = .white.withAlphaComponent(0.8)
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    // MARK: - Session Status Bar
    
    private lazy var sessionStatusBar: UIView = {
        let view = UIView()
        view.backgroundColor = SG.card
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var sessionIcon: UIImageView = {
        let imageView = UIImageView()
        imageView.image = UIImage(systemName: "clock.fill")
        imageView.tintColor = SG.accent
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var sessionStatusLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textColor = SG.foreground
        label.text = "Session Active"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var sessionTimerLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedDigitSystemFont(ofSize: 14, weight: .semibold)
        label.textColor = SG.accent
        label.textAlignment = .right
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var endSessionButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("End Session", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        button.backgroundColor = SG.deny
        button.layer.cornerRadius = 8
        button.addTarget(self, action: #selector(endSessionTapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()
    
    // MARK: - Apps Sections
    
    private lazy var requiredAppsHeader: UILabel = {
        let label = UILabel()
        label.font = SG.sans(18, .bold)
        label.textColor = SG.foreground
        label.text = "Required Apps"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var requiredAppsCollectionView: UICollectionView = {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.minimumInteritemSpacing = 12
        layout.minimumLineSpacing = 12
        layout.sectionInset = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        
        let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        return collectionView
    }()
    
    private lazy var optionalAppsHeader: UILabel = {
        let label = UILabel()
        label.font = SG.sans(18, .bold)
        label.textColor = SG.foreground
        label.text = "Available Apps"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var optionalAppsCollectionView: UICollectionView = {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.minimumInteritemSpacing = 12
        layout.minimumLineSpacing = 12
        layout.sectionInset = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        
        let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        return collectionView
    }()
    
    // MARK: - Quick Actions
    
    private lazy var quickActionsHeader: UILabel = {
        let label = UILabel()
        label.font = SG.sans(18, .bold)
        label.textColor = SG.foreground
        label.text = "Quick Actions"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var quickActionsStack: UIStackView = {
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()
    
    // MARK: - Restrictions Info
    
    private lazy var restrictionsHeader: UILabel = {
        let label = UILabel()
        label.font = SG.sans(18, .bold)
        label.textColor = SG.foreground
        label.text = "Session Restrictions"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var restrictionsStack: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        configureWithSession()
        startTimers()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        #if targetEnvironment(simulator)
        // Demo: auto-open the first workspace app in the in-app managed browser to show
        // app access staying native/contained inside the kiosk (not external Safari).
        // Latched to fire ONCE per session; a pending present is dropped if the view
        // is already showing something else.
        if DemoMode.openApp, !didAutoOpenApp,
           let app = SessionStateManager.shared.currentSession?.persona.appLaunchConfig.requiredApps.first,
           let urlString = app.launchUrl, let url = URL(string: urlString) {
            didAutoOpenApp = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                guard let self, self.presentedViewController == nil else { return }
                self.present(
                    ManagedAppViewController(
                        app: app,
                        url: url,
                        allowedDomains: SessionStateManager.shared.currentSession?.persona.restrictions.allowedDomains
                    ),
                    animated: true
                )
            }
        }
        // Demo: auto-open the embedded Assist host-app demo (invisible gate flow). Once per session.
        if DemoMode.assist, !didAutoOpenAssist {
            didAutoOpenAssist = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, self.presentedViewController == nil else { return }
                self.present(HostAppViewController(config: HostAppViewController.forLocation(DemoMode.location)), animated: true)
            }
        }
        // Demo: auto-end the session after a beat so the terminate -> teardown ->
        // lockedIdle flow can be exercised without tapping "End Session".
        if DemoMode.autoEnd {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
                guard SessionStateManager.shared.currentState == .activeSession else { return }
                SessionStateManager.shared.endSession(userInitiated: true)
            }
        }
        #endif
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        updateSessionTimer()
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopTimers()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.backgroundColor = SG.background
        
        // Add scroll view
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        // Add all subviews to content view
        contentView.addSubview(profileHeaderView)
        profileHeaderView.addSubview(avatarView)
        avatarView.addSubview(avatarLabel)
        profileHeaderView.addSubview(userNameLabel)
        profileHeaderView.addSubview(userRoleLabel)
        profileHeaderView.addSubview(departmentLabel)
        
        contentView.addSubview(sessionStatusBar)
        sessionStatusBar.addSubview(sessionIcon)
        sessionStatusBar.addSubview(sessionStatusLabel)
        sessionStatusBar.addSubview(sessionTimerLabel)
        sessionStatusBar.addSubview(endSessionButton)
        
        contentView.addSubview(requiredAppsHeader)
        contentView.addSubview(requiredAppsCollectionView)
        
        contentView.addSubview(optionalAppsHeader)
        contentView.addSubview(optionalAppsCollectionView)
        
        contentView.addSubview(quickActionsHeader)
        contentView.addSubview(quickActionsStack)
        
        contentView.addSubview(restrictionsHeader)
        contentView.addSubview(restrictionsStack)
        
        setupConstraints()
        setupCollectionViews()
        setupQuickActions()
    }
    
    private func setupConstraints() {
        NSLayoutConstraint.activate([
            // Scroll view
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            // Content view
            contentView.topAnchor.constraint(equalTo: scrollView.topAnchor),
            contentView.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor),
            contentView.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor),
            contentView.widthAnchor.constraint(equalTo: scrollView.widthAnchor),
            
            // Profile header
            profileHeaderView.topAnchor.constraint(equalTo: contentView.topAnchor),
            profileHeaderView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            profileHeaderView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            profileHeaderView.heightAnchor.constraint(equalToConstant: 180),
            
            // Avatar
            avatarView.topAnchor.constraint(equalTo: profileHeaderView.topAnchor, constant: 40),
            avatarView.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            avatarView.widthAnchor.constraint(equalToConstant: 80),
            avatarView.heightAnchor.constraint(equalToConstant: 80),
            
            avatarLabel.centerXAnchor.constraint(equalTo: avatarView.centerXAnchor),
            avatarLabel.centerYAnchor.constraint(equalTo: avatarView.centerYAnchor),
            
            userNameLabel.topAnchor.constraint(equalTo: avatarView.bottomAnchor, constant: 12),
            userNameLabel.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            userNameLabel.trailingAnchor.constraint(equalTo: profileHeaderView.trailingAnchor, constant: -20),
            
            userRoleLabel.topAnchor.constraint(equalTo: userNameLabel.bottomAnchor, constant: 4),
            userRoleLabel.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            userRoleLabel.trailingAnchor.constraint(equalTo: profileHeaderView.trailingAnchor, constant: -20),
            
            departmentLabel.topAnchor.constraint(equalTo: userRoleLabel.bottomAnchor, constant: 2),
            departmentLabel.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            departmentLabel.trailingAnchor.constraint(equalTo: profileHeaderView.trailingAnchor, constant: -20),
            
            // Session status bar
            sessionStatusBar.topAnchor.constraint(equalTo: profileHeaderView.bottomAnchor),
            sessionStatusBar.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            sessionStatusBar.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            sessionStatusBar.heightAnchor.constraint(equalToConstant: 56),
            
            sessionIcon.leadingAnchor.constraint(equalTo: sessionStatusBar.leadingAnchor, constant: 16),
            sessionIcon.centerYAnchor.constraint(equalTo: sessionStatusBar.centerYAnchor),
            sessionIcon.widthAnchor.constraint(equalToConstant: 24),
            sessionIcon.heightAnchor.constraint(equalToConstant: 24),
            
            sessionStatusLabel.leadingAnchor.constraint(equalTo: sessionIcon.trailingAnchor, constant: 8),
            sessionStatusLabel.centerYAnchor.constraint(equalTo: sessionStatusBar.centerYAnchor),
            
            sessionTimerLabel.trailingAnchor.constraint(equalTo: endSessionButton.leadingAnchor, constant: -16),
            sessionTimerLabel.centerYAnchor.constraint(equalTo: sessionStatusBar.centerYAnchor),
            
            endSessionButton.trailingAnchor.constraint(equalTo: sessionStatusBar.trailingAnchor, constant: -16),
            endSessionButton.centerYAnchor.constraint(equalTo: sessionStatusBar.centerYAnchor),
            endSessionButton.widthAnchor.constraint(equalToConstant: 100),
            endSessionButton.heightAnchor.constraint(equalToConstant: 36),
            
            // Required apps header
            requiredAppsHeader.topAnchor.constraint(equalTo: sessionStatusBar.bottomAnchor, constant: 20),
            requiredAppsHeader.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            requiredAppsHeader.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            // Required apps collection view
            requiredAppsCollectionView.topAnchor.constraint(equalTo: requiredAppsHeader.bottomAnchor, constant: 8),
            requiredAppsCollectionView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            requiredAppsCollectionView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            requiredAppsCollectionView.heightAnchor.constraint(equalToConstant: 130),
            
            // Optional apps header
            optionalAppsHeader.topAnchor.constraint(equalTo: requiredAppsCollectionView.bottomAnchor, constant: 20),
            optionalAppsHeader.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            optionalAppsHeader.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            // Optional apps collection view
            optionalAppsCollectionView.topAnchor.constraint(equalTo: optionalAppsHeader.bottomAnchor, constant: 8),
            optionalAppsCollectionView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            optionalAppsCollectionView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            optionalAppsCollectionView.heightAnchor.constraint(equalToConstant: 130),
            
            // Quick actions header
            quickActionsHeader.topAnchor.constraint(equalTo: optionalAppsCollectionView.bottomAnchor, constant: 20),
            quickActionsHeader.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            quickActionsHeader.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            // Quick actions stack
            quickActionsStack.topAnchor.constraint(equalTo: quickActionsHeader.bottomAnchor, constant: 12),
            quickActionsStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            quickActionsStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            quickActionsStack.heightAnchor.constraint(equalToConstant: 80),
            
            // Restrictions header
            restrictionsHeader.topAnchor.constraint(equalTo: quickActionsStack.bottomAnchor, constant: 24),
            restrictionsHeader.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            restrictionsHeader.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            // Restrictions stack
            restrictionsStack.topAnchor.constraint(equalTo: restrictionsHeader.bottomAnchor, constant: 12),
            restrictionsStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            restrictionsStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            restrictionsStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -32)
        ])
    }
    
    private func setupCollectionViews() {
        requiredAppsCollectionView.delegate = self
        requiredAppsCollectionView.dataSource = self
        requiredAppsCollectionView.register(HomeScreenAppCell.self, forCellWithReuseIdentifier: "HomeScreenAppCell")
        
        optionalAppsCollectionView.delegate = self
        optionalAppsCollectionView.dataSource = self
        optionalAppsCollectionView.register(HomeScreenAppCell.self, forCellWithReuseIdentifier: "HomeScreenAppCell")
    }
    
    private func setupQuickActions() {
        // Lock device action
        let lockButton = createQuickActionButton(
            icon: "lock.fill",
            title: "Lock",
            color: SG.accent
        )
        lockButton.addTarget(self, action: #selector(lockDeviceTapped), for: .touchUpInside)
        
        // Refresh session action
        let refreshButton = createQuickActionButton(
            icon: "arrow.clockwise",
            title: "Refresh",
            color: SG.accent
        )
        refreshButton.addTarget(self, action: #selector(refreshSessionTapped), for: .touchUpInside)
        
        // Host app (embedded Assist flow) — the invisible-gate reference.
        let hostAppButton = createQuickActionButton(
            icon: "cross.case.fill",
            title: "Host App",
            color: SG.accent
        )
        hostAppButton.addTarget(self, action: #selector(hostAppTapped), for: .touchUpInside)

        // Help action
        let helpButton = createQuickActionButton(
            icon: "questionmark.circle.fill",
            title: "Help",
            color: SG.accent
        )
        helpButton.addTarget(self, action: #selector(helpTapped), for: .touchUpInside)

        quickActionsStack.addArrangedSubview(lockButton)
        quickActionsStack.addArrangedSubview(hostAppButton)
        quickActionsStack.addArrangedSubview(refreshButton)
        quickActionsStack.addArrangedSubview(helpButton)
    }

    /// Open the embedded Assist host-app demo — a generic, un-branded host app with
    /// the invisible SignalGrid gate underneath (allow → auto, sensitive → native
    /// step-up + host confirm, per EMBEDDED_UX_PRINCIPLE.md). Presented contained
    /// inside the kiosk, like ManagedAppViewController.
    @objc private func hostAppTapped() {
        SessionStateManager.shared.userDidInteract()
        present(HostAppViewController(config: hostAppConfig()), animated: true)
    }

    /// The host app matching the deployment location (clinic → clinical chart,
    /// warehouse → warehouse handheld). Same invisible gate, different app.
    private func hostAppConfig() -> HostAppViewController.HostAppConfig {
        #if targetEnvironment(simulator)
        return HostAppViewController.forLocation(DemoMode.location)
        #else
        return HostAppViewController.clinical()
        #endif
    }
    
    private func createQuickActionButton(icon: String, title: String, color: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        button.backgroundColor = color.withAlphaComponent(0.15)
        button.layer.cornerRadius = 12
        
        let imageView = UIImageView(image: UIImage(systemName: icon))
        imageView.tintColor = color
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        
        let label = UILabel()
        label.text = title
        label.font = UIFont.systemFont(ofSize: 12, weight: .medium)
        label.textColor = color
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        
        button.addSubview(imageView)
        button.addSubview(label)
        
        NSLayoutConstraint.activate([
            imageView.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            imageView.topAnchor.constraint(equalTo: button.topAnchor, constant: 16),
            imageView.widthAnchor.constraint(equalToConstant: 24),
            imageView.heightAnchor.constraint(equalToConstant: 24),
            
            label.topAnchor.constraint(equalTo: imageView.bottomAnchor, constant: 8),
            label.centerXAnchor.constraint(equalTo: button.centerXAnchor)
        ])
        
        return button
    }
    
    private func configureWithSession() {
        guard let session = session else { return }
        
        // Configure profile header
        let initials = getInitials(from: session.persona.roleName)
        avatarLabel.text = initials
        
        userNameLabel.text = session.persona.roleName
        userRoleLabel.text = "Role: \(session.persona.roleName)"
        
        // Get department from user info if available
        departmentLabel.text = "User ID: \(session.userId)"
        
        // Update header color based on theme if available
        if let primaryColor = session.persona.workspaceConfig.theme.primaryColor as String? {
            profileHeaderView.backgroundColor = UIColor(hex: primaryColor) ?? SG.primary
        }
        
        // Configure restrictions
        configureRestrictions(session.persona.restrictions)
        
        // Reload collection views
        requiredAppsCollectionView.reloadData()
        optionalAppsCollectionView.reloadData()
    }
    
    private func configureRestrictions(_ restrictions: SessionRestrictions) {
        // Clear existing restrictions
        restrictionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        
        // Add restriction items
        let idleMinutes = Int(restrictions.idleTimeout / 60)
        addRestrictionItem(icon: "clock", title: "Idle Timeout", value: "\(idleMinutes) minutes")
        addRestrictionItem(icon: restrictions.allowCopyPaste ? "checkmark.circle.fill" : "xmark.circle.fill", 
                          title: "Copy/Paste", value: restrictions.allowCopyPaste ? "Allowed" : "Blocked")
        addRestrictionItem(icon: restrictions.allowScreenCapture ? "checkmark.circle.fill" : "xmark.circle.fill",
                          title: "Screen Capture", value: restrictions.allowScreenCapture ? "Allowed" : "Blocked")
        addRestrictionItem(icon: restrictions.allowPrint ? "checkmark.circle.fill" : "xmark.circle.fill",
                          title: "Print", value: restrictions.allowPrint ? "Allowed" : "Blocked")
        
        // Show max session duration if set
        if let maxDuration = restrictions.maxSessionDuration {
            let hours = Int(maxDuration / 3600)
            addRestrictionItem(icon: "hourglass", title: "Max Session", value: "\(hours) hours")
        }
    }
    
    private func addRestrictionItem(icon: String, title: String, value: String) {
        let container = UIView()
        container.backgroundColor = SG.card
        container.layer.cornerRadius = 8
        container.translatesAutoresizingMaskIntoConstraints = false
        
        let iconView = UIImageView(image: UIImage(systemName: icon))
        iconView.tintColor = SG.accent
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        titleLabel.textColor = SG.foreground
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        let valueLabel = UILabel()
        valueLabel.text = value
        valueLabel.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        valueLabel.textColor = SG.mutedFg
        valueLabel.textAlignment = .right
        valueLabel.translatesAutoresizingMaskIntoConstraints = false
        
        container.addSubview(iconView)
        container.addSubview(titleLabel)
        container.addSubview(valueLabel)
        
        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(equalToConstant: 44),
            
            iconView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            iconView.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 20),
            iconView.heightAnchor.constraint(equalToConstant: 20),
            
            titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 12),
            titleLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            
            valueLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            valueLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])
        
        restrictionsStack.addArrangedSubview(container)
    }
    
    // MARK: - Timer Management
    
    private func startTimers() {
        // Update timer display every second
        displayTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateSessionTimer()
        }
    }
    
    private func stopTimers() {
        displayTimer?.invalidate()
        displayTimer = nil
        sessionTimer?.invalidate()
        sessionTimer = nil
    }
    
    private func updateSessionTimer() {
        guard let session = session else {
            sessionTimerLabel.text = "--:--:--"
            return
        }
        
        let startedAt = session.startedAt
        // Use maxSessionDuration if available, otherwise fall back to idleTimeout
        let sessionDuration = session.persona.restrictions.maxSessionDuration ?? session.persona.restrictions.idleTimeout
        let expiresAt = startedAt.addingTimeInterval(sessionDuration)
        let remaining = expiresAt.timeIntervalSince(Date())
        
        if remaining > 0 {
            let hours = Int(remaining) / 3600
            let minutes = (Int(remaining) % 3600) / 60
            let seconds = Int(remaining) % 60
            
            if hours > 0 {
                sessionTimerLabel.text = String(format: "%d:%02d:%02d", hours, minutes, seconds)
            } else {
                sessionTimerLabel.text = String(format: "%02d:%02d", minutes, seconds)
            }
            
            // Change color based on remaining time
            if remaining < 60 {
                sessionTimerLabel.textColor = SG.deny
            } else if remaining < 300 {
                sessionTimerLabel.textColor = SG.review
            } else {
                sessionTimerLabel.textColor = SG.accent
            }
        } else {
            sessionTimerLabel.text = "Expired"
            sessionTimerLabel.textColor = SG.deny
        }
    }
    
    // MARK: - Actions
    
    @objc private func endSessionTapped() {
        let alert = UIAlertController(
            title: "End Session",
            message: "Are you sure you want to end your session? All unsaved work will be lost.",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "End Session", style: .destructive) { [weak self] _ in
            SessionStateManager.shared.endSession(userInitiated: true)
        })
        
        present(alert, animated: true)
    }
    
    @objc private func lockDeviceTapped() {
        let alert = UIAlertController(
            title: "Lock Device",
            message: "This will lock the device and require badge authentication to continue.",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Lock", style: .default) { _ in
            SessionStateManager.shared.endSession(userInitiated: true)
        })
        
        present(alert, animated: true)
    }
    
    @objc private func refreshSessionTapped() {
        // Show refreshing indicator
        let alert = UIAlertController(
            title: "Refreshing Session",
            message: "Verifying session credentials...",
            preferredStyle: .alert
        )
        
        present(alert, animated: true) {
            // Simulate refresh (in real app, call backend)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                alert.dismiss(animated: true) {
                    self.showToast(message: "Session refreshed successfully")
                }
            }
        }
    }
    
    @objc private func helpTapped() {
        let alert = UIAlertController(
            title: "Help & Support",
            message: "For assistance, please contact your IT administrator.",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    private func showToast(message: String) {
        let toast = UILabel()
        toast.text = message
        toast.textColor = .white
        toast.backgroundColor = SG.allow
        toast.textAlignment = .center
        toast.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        toast.layer.cornerRadius = 8
        toast.clipsToBounds = true
        toast.alpha = 0
        toast.translatesAutoresizingMaskIntoConstraints = false
        
        view.addSubview(toast)
        
        NSLayoutConstraint.activate([
            toast.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            toast.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            toast.widthAnchor.constraint(equalToConstant: 250),
            toast.heightAnchor.constraint(equalToConstant: 40)
        ])
        
        UIView.animate(withDuration: 0.3, animations: {
            toast.alpha = 1
        }) { _ in
            UIView.animate(withDuration: 0.3, delay: 2.0, options: [], animations: {
                toast.alpha = 0
            }) { _ in
                toast.removeFromSuperview()
            }
        }
    }
    
    // MARK: - Helpers
    
    private func getInitials(from name: String) -> String {
        let words = name.split(separator: " ")
        let initials = words.prefix(2).compactMap { $0.first }.map { String($0) }
        return initials.joined().uppercased()
    }
}

// MARK: - UICollectionViewDataSource

extension ActiveSessionViewController: UICollectionViewDataSource {
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        if collectionView == requiredAppsCollectionView {
            return session?.persona.appLaunchConfig.requiredApps.count ?? 0
        } else {
            return session?.persona.appLaunchConfig.optionalApps.count ?? 0
        }
    }
    
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        guard let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "HomeScreenAppCell", for: indexPath) as? HomeScreenAppCell else {
            // Return an empty cell if casting fails - should not happen in normal flow
            return UICollectionViewCell()
        }
        
        if collectionView == requiredAppsCollectionView {
            if let apps = session?.persona.appLaunchConfig.requiredApps,
               indexPath.item < apps.count {
                cell.configure(with: apps[indexPath.item])
            }
        } else {
            if let apps = session?.persona.appLaunchConfig.optionalApps,
               indexPath.item < apps.count {
                cell.configure(with: apps[indexPath.item])
            }
        }
        
        return cell
    }
}

// MARK: - UICollectionViewDelegate

extension ActiveSessionViewController: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        var app: EnterpriseApp?
        
        if collectionView == requiredAppsCollectionView {
            if let apps = session?.persona.appLaunchConfig.requiredApps,
               indexPath.item < apps.count {
                app = apps[indexPath.item]
            }
        } else {
            if let apps = session?.persona.appLaunchConfig.optionalApps,
               indexPath.item < apps.count {
                app = apps[indexPath.item]
            }
        }
        
        guard let selectedApp = app else { return }

        // Kiosk containment: a web app opens in an in-app managed browser so the device
        // stays NATIVE and contained inside EnterpriseShell — it must not hand off to the
        // external Safari app, which would let a user leave the locked kiosk. Only true
        // native/deep-link apps launch through the OS via AppLauncher.
        if !selectedApp.isDeepLink,
           let urlString = selectedApp.launchUrl,
           let url = URL(string: urlString),
           ["http", "https"].contains((url.scheme ?? "").lowercased()) {
            AuditLogger.shared.log(event: .appLaunched, metadata: [
                "appId": selectedApp.appId, "mode": "managed_webview"
            ])
            present(
                ManagedAppViewController(
                    app: selectedApp,
                    url: url,
                    allowedDomains: session?.persona.restrictions.allowedDomains
                ),
                animated: true
            )
            return
        }

        Task {
            do {
                try await AppLauncher.shared.launchEnterpriseApp(selectedApp)
            } catch {
                showAppLaunchError(error)
            }
        }
    }
    
    private func showAppLaunchError(_ error: Error) {
        let alert = UIAlertController(
            title: "Cannot Launch App",
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - UICollectionViewDelegateFlowLayout

extension ActiveSessionViewController: UICollectionViewDelegateFlowLayout {
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        return CGSize(width: 100, height: 120)
    }
}

// MARK: - HomeScreenAppCell

final class HomeScreenAppCell: UICollectionViewCell {
    private lazy var iconContainerView: UIView = {
        let view = UIView()
        view.backgroundColor = SG.primary.withAlphaComponent(0.18)
        view.layer.cornerRadius = 20
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var iconImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.tintColor = SG.accent
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.font = SG.sans(12, .medium)
        label.textColor = SG.foreground
        label.textAlignment = .center
        label.numberOfLines = 2
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var statusIndicator: UIView = {
        let view = UIView()
        view.backgroundColor = SG.allow
        view.layer.cornerRadius = 4
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        setupUI()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        contentView.addSubview(iconContainerView)
        iconContainerView.addSubview(iconImageView)
        contentView.addSubview(titleLabel)
        contentView.addSubview(statusIndicator)
        
        NSLayoutConstraint.activate([
            iconContainerView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
            iconContainerView.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            iconContainerView.widthAnchor.constraint(equalToConstant: 60),
            iconContainerView.heightAnchor.constraint(equalToConstant: 60),
            
            iconImageView.centerXAnchor.constraint(equalTo: iconContainerView.centerXAnchor),
            iconImageView.centerYAnchor.constraint(equalTo: iconContainerView.centerYAnchor),
            iconImageView.widthAnchor.constraint(equalToConstant: 32),
            iconImageView.heightAnchor.constraint(equalToConstant: 32),
            
            titleLabel.topAnchor.constraint(equalTo: iconContainerView.bottomAnchor, constant: 8),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 4),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -4),
            
            statusIndicator.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            statusIndicator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -4),
            statusIndicator.widthAnchor.constraint(equalToConstant: 8),
            statusIndicator.heightAnchor.constraint(equalToConstant: 8)
        ])
    }
    
    func configure(with app: EnterpriseApp) {
        // Use app icon or default
        iconImageView.image = UIImage(systemName: "app.fill")
        titleLabel.text = app.displayName
        
        // Check if app has a deep link
        if app.isDeepLink {
            statusIndicator.backgroundColor = SG.accent
        } else {
            statusIndicator.backgroundColor = SG.allow
        }
    }
}

// MARK: - UIColor Extension

extension UIColor {
    convenience init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
        
        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }
        
        let r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
        let g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
        let b = CGFloat(rgb & 0x0000FF) / 255.0
        
        self.init(red: r, green: g, blue: b, alpha: 1.0)
    }
}
