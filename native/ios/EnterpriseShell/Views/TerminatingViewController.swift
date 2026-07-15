import UIKit

/// View controller shown during session termination
final class TerminatingViewController: UIViewController {
    
    // MARK: - UI Components
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.color = .systemOrange
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Ending Session"
        label.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Securely closing your session..."
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
    
    private let terminationSteps = [
        "Revoking authentication tokens...",
        "Clearing session data...",
        "Sending audit logs...",
        "Securing device..."
    ]
    
    private var stepIndex = 0
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startTerminationAnimation()
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
        for step in terminationSteps {
            let stepView = createStepView(step: step)
            stepView.alpha = 0.5
            stepsStackView.addArrangedSubview(stepView)
        }
    }
    
    private func createStepView(step: String) -> UIView {
        let container = UIView()
        
        let indicator = UIActivityIndicatorView(style: .small)
        indicator.tag = 100
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        
        let checkmark = UIImageView(image: UIImage(systemName: "circle"))
        checkmark.tintColor = .systemGray3
        checkmark.contentMode = .scaleAspectFit
        checkmark.isHidden = true
        checkmark.translatesAutoresizingMaskIntoConstraints = false
        
        let label = UILabel()
        label.text = step
        label.font = UIFont.systemFont(ofSize: 16, weight: .regular)
        label.textColor = .label
        label.translatesAutoresizingMaskIntoConstraints = false
        
        container.addSubview(indicator)
        container.addSubview(checkmark)
        container.addSubview(label)
        
        NSLayoutConstraint.activate([
            indicator.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            indicator.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            
            checkmark.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            checkmark.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            checkmark.widthAnchor.constraint(equalToConstant: 24),
            checkmark.heightAnchor.constraint(equalToConstant: 24),
            
            label.leadingAnchor.constraint(equalTo: indicator.trailingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])
        
        return container
    }
    
    private func startTerminationAnimation() {
        activityIndicator.startAnimating()
        
        var delay: TimeInterval = 0
        
        for (index, stepView) in stepsStackView.arrangedSubviews.enumerated() {
            delay += 0.6
            
            let indicator = stepView.viewWithTag(100) as? UIActivityIndicatorView
            let checkmark = stepView.subviews.compactMap { $0 as? UIImageView }.first(where: { $0.image != nil })
            
            UIView.animate(
                withDuration: 0.3,
                delay: delay,
                options: .curveEaseInOut
            ) {
                stepView.alpha = 1.0
                
                if let indicator = indicator {
                    indicator.startAnimating()
                    
                    UIView.animate(withDuration: 0.2) {
                        indicator.alpha = 0
                    } completion: { _ in
                        indicator.stopAnimating()
                        indicator.alpha = 1
                        checkmark?.isHidden = false
                        checkmark?.image = UIImage(systemName: "checkmark.circle.fill")
                        checkmark?.tintColor = .systemGreen
                    }
                }
            }
        }
        
        // Return to locked state after all steps complete
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 1.0) { [weak self] in
            self?.activityIndicator.stopAnimating()
            self?.statusLabel.text = "Session ended securely"
            self?.statusLabel.textColor = .systemGreen
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                // State transition is handled by SessionStateManager
            }
        }
    }
}
