import UIKit

/// View controller shown during session provisioning
final class ProvisioningViewController: UIViewController {
    
    // MARK: - UI Components
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.color = .systemBlue
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Setting Up Workspace"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Preparing your session..."
        label.font = UIFont.systemFont(ofSize: 18, weight: .medium)
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var stepsStackView: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()
    
    private let provisioningSteps = [
        "Loading user profile...",
        "Applying role permissions...",
        "Launching enterprise apps...",
        "Configuring workspace...",
        "Syncing data..."
    ]
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startProvisioningAnimation()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        view.addSubview(activityIndicator)
        view.addSubview(titleLabel)
        view.addSubview(statusLabel)
        view.addSubview(stepsStackView)
        
        NSLayoutConstraint.activate([
            activityIndicator.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 100),
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            
            titleLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            statusLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            
            stepsStackView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 40),
            stepsStackView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            stepsStackView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40)
        ])
        
        // Create step indicators
        for step in provisioningSteps {
            let stepView = createStepView(step: step)
            stepView.alpha = 0.5
            stepsStackView.addArrangedSubview(stepView)
        }
    }
    
    private func createStepView(step: String) -> UIView {
        let container = UIView()
        
        let checkmark = UIImageView(image: UIImage(systemName: "circle"))
        checkmark.tintColor = .systemGray3
        checkmark.contentMode = .scaleAspectFit
        checkmark.translatesAutoresizingMaskIntoConstraints = false
        
        let label = UILabel()
        label.text = step
        label.font = UIFont.systemFont(ofSize: 16, weight: .regular)
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false
        
        container.addSubview(checkmark)
        container.addSubview(label)
        
        NSLayoutConstraint.activate([
            checkmark.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            checkmark.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            checkmark.widthAnchor.constraint(equalToConstant: 24),
            checkmark.heightAnchor.constraint(equalToConstant: 24),
            
            label.leadingAnchor.constraint(equalTo: checkmark.trailingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])
        
        container.tag = provisioningSteps.firstIndex(of: step) ?? 0
        
        return container
    }
    
    private func startProvisioningAnimation() {
        activityIndicator.startAnimating()
        
        var delay: TimeInterval = 0
        
        for (index, stepView) in stepsStackView.arrangedSubviews.enumerated() {
            delay += 0.8
            
            UIView.animate(
                withDuration: 0.3,
                delay: delay,
                options: .curveEaseInOut
            ) {
                stepView.alpha = 1.0
                
                // Update checkmark
                if let checkmark = stepView.subviews.first(where: { $0 is UIImageView }) as? UIImageView {
                    checkmark.image = UIImage(systemName: index < self.provisioningSteps.count - 1 ? "checkmark.circle.fill" : "checkmark.circle.fill")
                    checkmark.tintColor = .systemGreen
                }
            }
        }
    }
}
