import UIKit

/// View controller shown when a badge is not enrolled - handles HID reader provisioning
final class EnrollingViewController: UIViewController {
    
    // MARK: - Properties
    
    private let badgeId: String
    
    // MARK: - UI Components
    
    private lazy var backgroundView: UIView = {
        let view = UIView()
        view.backgroundColor = .systemBackground
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var iconImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.image = UIImage(systemName: "person.badge.key.fill")
        imageView.tintColor = .systemOrange
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Badge Not Enrolled"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textAlignment = .center
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var messageLabel: UILabel = {
        let label = UILabel()
        label.text = "Your badge is not registered in the system. Please contact your administrator to enroll your badge, or use a different badge that is already enrolled."
        label.font = UIFont.systemFont(ofSize: 16, weight: .regular)
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var badgeInfoView: UIView = {
        let view = UIView()
        view.backgroundColor = .secondarySystemBackground
        view.layer.cornerRadius = 12
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var badgeIdLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .medium)
        label.textColor = .label
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var retryButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Try Another Badge", for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 18, weight: .semibold)
        button.backgroundColor = .systemBlue
        button.setTitleColor(.white, for: .normal)
        button.layer.cornerRadius = 12
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        return button
    }()
    
    private lazy var helpButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Contact Administrator", for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        button.setTitleColor(.systemBlue, for: .normal)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(helpTapped), for: .touchUpInside)
        return button
    }()
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    // MARK: - Initialization
    
    init(badgeId: String) {
        self.badgeId = badgeId
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Reset to show we're checking enrollment
        activityIndicator.startAnimating()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The enrollment determination resolves quickly; stop the spinner so the
        // "not registered" guidance and its action buttons are the clear final state
        // (rather than spinning forever behind the message).
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.activityIndicator.stopAnimating()
        }
    }
    
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        activityIndicator.stopAnimating()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.addSubview(backgroundView)
        view.addSubview(iconImageView)
        view.addSubview(titleLabel)
        view.addSubview(messageLabel)
        view.addSubview(badgeInfoView)
        badgeInfoView.addSubview(badgeIdLabel)
        view.addSubview(activityIndicator)
        view.addSubview(retryButton)
        view.addSubview(helpButton)
        
        // Display masked badge ID
        badgeIdLabel.text = "Badge ID: \(maskBadgeId(badgeId))"
        
        NSLayoutConstraint.activate([
            // Background
            backgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            // Icon
            iconImageView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            iconImageView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 80),
            iconImageView.widthAnchor.constraint(equalToConstant: 80),
            iconImageView.heightAnchor.constraint(equalToConstant: 80),
            
            // Title
            titleLabel.topAnchor.constraint(equalTo: iconImageView.bottomAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            // Message
            messageLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            messageLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            messageLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            
            // Badge Info
            badgeInfoView.topAnchor.constraint(equalTo: messageLabel.bottomAnchor, constant: 24),
            badgeInfoView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            badgeInfoView.widthAnchor.constraint(equalToConstant: 250),
            badgeInfoView.heightAnchor.constraint(equalToConstant: 50),
            
            badgeIdLabel.centerXAnchor.constraint(equalTo: badgeInfoView.centerXAnchor),
            badgeIdLabel.centerYAnchor.constraint(equalTo: badgeInfoView.centerYAnchor),
            
            // Activity Indicator
            activityIndicator.topAnchor.constraint(equalTo: badgeInfoView.bottomAnchor, constant: 16),
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            
            // Retry Button
            retryButton.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 32),
            retryButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            retryButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            retryButton.heightAnchor.constraint(equalToConstant: 56),
            
            // Help Button
            helpButton.topAnchor.constraint(equalTo: retryButton.bottomAnchor, constant: 16),
            helpButton.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
    }
    
    // MARK: - Actions
    
    @objc private func retryTapped() {
        // Transition back to locked idle to try another badge
        SessionStateManager.shared.transition(to: .lockedIdle)
    }
    
    @objc private func helpTapped() {
        // Show contact information or help
        showHelpAlert()
    }
    
    private func showHelpAlert() {
        let alert = UIAlertController(
            title: "Need Help?",
            message: "Please contact your IT administrator to enroll your badge. You may need to provide your employee information and the badge ID shown on screen.",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        
        if let email = getAdminEmail() {
            alert.addAction(UIAlertAction(title: "Email IT Support", style: .default) { _ in
                self.openMailTo(email: email)
            })
        }
        
        present(alert, animated: true)
    }
    
    private func getAdminEmail() -> String? {
        // Could be stored in configuration or retrieved from backend
        return nil
    }
    
    private func openMailTo(email: String) {
        if let url = URL(string: "mailto:\(email)") {
            UIApplication.shared.open(url)
        }
    }
    
    private func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else {
            return "****"
        }
        let prefix = badgeId.prefix(2)
        let suffix = badgeId.suffix(2)
        return "\(prefix)****\(suffix)"
    }
}
