import UIKit

/// View controller shown immediately after badge is captured
final class BadgeCapturedViewController: UIViewController {
    
    // MARK: - Properties
    
    private let badgeId: String
    
    init(badgeId: String) {
        self.badgeId = badgeId
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    // MARK: - UI Components
    
    private lazy var containerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var iconView: UIImageView = {
        let imageView = UIImageView()
        imageView.image = UIImage(systemName: "checkmark.circle.fill")
        imageView.tintColor = .systemGreen
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Badge Recognized"
        label.font = UIFont.systemFont(ofSize: 24, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var badgeLabel: UILabel = {
        let label = UILabel()
        label.font = UIFont.monospacedSystemFont(ofSize: 16, weight: .regular)
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Authenticating..."
        label.font = UIFont.systemFont(ofSize: 18, weight: .medium)
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var cancelButton: UIButton = {
        let button = UIButton(type: .system)
        button.setTitle("Cancel", for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        button.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        view.addSubview(containerView)
        containerView.addSubview(iconView)
        containerView.addSubview(titleLabel)
        containerView.addSubview(badgeLabel)
        containerView.addSubview(statusLabel)
        containerView.addSubview(cancelButton)
        
        badgeLabel.text = "Badge ID: \(maskBadgeId(badgeId))"
        
        NSLayoutConstraint.activate([
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),
            
            iconView.topAnchor.constraint(equalTo: containerView.topAnchor),
            iconView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 80),
            iconView.heightAnchor.constraint(equalToConstant: 80),
            
            titleLabel.topAnchor.constraint(equalTo: iconView.bottomAnchor, constant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            badgeLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            badgeLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            badgeLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            statusLabel.topAnchor.constraint(equalTo: badgeLabel.bottomAnchor, constant: 24),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            cancelButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 40),
            cancelButton.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            cancelButton.bottomAnchor.constraint(equalTo: containerView.bottomAnchor)
        ])
        
        // Animate icon
        animateIcon()
    }
    
    private func animateIcon() {
        iconView.transform = CGAffineTransform(scaleX: 0.1, y: 0.1)
        
        UIView.animate(
            withDuration: 0.5,
            delay: 0,
            usingSpringWithDamping: 0.6,
            initialSpringVelocity: 0.5,
            options: .curveEaseOut
        ) {
            self.iconView.transform = .identity
        }
    }
    
    private func maskBadgeId(_ badgeId: String) -> String {
        guard badgeId.count > 4 else { return "****" }
        let prefix = String(badgeId.prefix(2))
        let suffix = String(badgeId.suffix(2))
        return "\(prefix)****\(suffix)"
    }
    
    // MARK: - Actions
    
    @objc private func cancelTapped() {
        SessionStateManager.shared.transition(to: .lockedIdle)
    }
}
