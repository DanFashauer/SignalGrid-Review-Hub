import UIKit

/// View controller for the locked idle state - shows login prompt
final class LockedIdleViewController: UIViewController {
    
    // MARK: - UI Components
    
    private lazy var backgroundView: UIView = {
        let view = UIView()
        view.backgroundColor = .systemBackground
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var logoImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.image = UIImage(systemName: "building.2")
        imageView.tintColor = .systemBlue
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Enterprise Device"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textAlignment = .center
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var instructionLabel: UILabel = {
        let label = UILabel()
        label.text = "Tap your badge to begin session"
        label.font = UIFont.systemFont(ofSize: 18, weight: .medium)
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var badgeIconView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.image = UIImage(systemName: "creditcard.fill")
        imageView.tintColor = .systemGray3
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 14, weight: .regular)
        label.textAlignment = .center
        label.textColor = .tertiaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    private lazy var errorLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        label.textAlignment = .center
        label.textColor = .systemRed
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isHidden = true
        return label
    }()
    
    private var badgeReaderObserver: NSObjectProtocol?
    private var stateChangeObserver: NSObjectProtocol?
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        setupBadgeReaderObserver()
        setupStateChangeObserver()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        updateReaderStatus()
        checkForLastError()
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopBadgeIconAnimation()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        updateReaderStatus()
        #if targetEnvironment(simulator)
        // The simulator has no badge-reader hardware. If launched with
        // `-SimulateBadge <id>`, inject that badge so the session flow can be
        // exercised end-to-end without a physical reader.
        if let badge = UserDefaults.standard.string(forKey: "SimulateBadge"), !badge.isEmpty {
            UserDefaults.standard.removeObject(forKey: "SimulateBadge")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                SessionStateManager.shared.onBadgeScanned(badge)
            }
        }
        #endif
    }
    
    deinit {
        if let observer = badgeReaderObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = stateChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.addSubview(backgroundView)
        view.addSubview(logoImageView)
        view.addSubview(titleLabel)
        view.addSubview(instructionLabel)
        view.addSubview(badgeIconView)
        view.addSubview(activityIndicator)
        view.addSubview(statusLabel)
        view.addSubview(errorLabel)
        
        NSLayoutConstraint.activate([
            // Background
            backgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            // Logo
            logoImageView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            logoImageView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 80),
            logoImageView.widthAnchor.constraint(equalToConstant: 100),
            logoImageView.heightAnchor.constraint(equalToConstant: 100),
            
            // Title
            titleLabel.topAnchor.constraint(equalTo: logoImageView.bottomAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Instruction
            instructionLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            instructionLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            instructionLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Badge Icon
            badgeIconView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            badgeIconView.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: 40),
            badgeIconView.widthAnchor.constraint(equalToConstant: 80),
            badgeIconView.heightAnchor.constraint(equalToConstant: 60),
            
            // Activity Indicator
            activityIndicator.topAnchor.constraint(equalTo: badgeIconView.bottomAnchor, constant: 24),
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            
            // Status
            statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Error Label
            errorLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        
        // Animate badge icon
        animateBadgeIcon()
    }
    
    private func setupBadgeReaderObserver() {
        badgeReaderObserver = NotificationCenter.default.addObserver(
            forName: .EAAccessoryDidConnect,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateReaderStatus()
        }
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDisconnected),
            name: .EAAccessoryDidDisconnect,
            object: nil
        )
    }
    
    private func setupStateChangeObserver() {
        stateChangeObserver = NotificationCenter.default.addObserver(
            forName: .sessionStateDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let newState = notification.userInfo?[SessionStateNotificationKeys.newState] as? SessionState else {
                return
            }
            
            // Check for errors when transitioning to lockedIdle
            if newState == .lockedIdle {
                self?.checkForLastError()
            }
        }
    }
    
    private func checkForLastError() {
        if let error = SessionStateManager.shared.lastError {
            errorLabel.text = error.localizedDescription
            errorLabel.isHidden = false
            
            // Auto-hide after 10 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                self?.errorLabel.isHidden = true
            }
        } else {
            errorLabel.isHidden = true
        }
    }
    
    private func updateReaderStatus() {
        if BadgeReaderManager.shared.isConnected {
            statusLabel.text = "Badge reader connected - Ready to scan"
            statusLabel.textColor = .systemGreen
            activityIndicator.stopAnimating()
        } else {
            statusLabel.text = "No badge reader detected"
            statusLabel.textColor = .systemOrange
            activityIndicator.startAnimating()
        }
    }
    
    @objc private func accessoryDisconnected() {
        updateReaderStatus()
    }
    
    private func animateBadgeIcon() {
        UIView.animate(
            withDuration: 1.5,
            delay: 0,
            options: [.repeat, .autoreverse],
            animations: {
                self.badgeIconView.transform = CGAffineTransform(scaleX: 1.1, y: 1.1)
            }
        )
    }
    
    private func stopBadgeIconAnimation() {
        badgeIconView.layer.removeAllAnimations()
        badgeIconView.transform = .identity
    }
}
