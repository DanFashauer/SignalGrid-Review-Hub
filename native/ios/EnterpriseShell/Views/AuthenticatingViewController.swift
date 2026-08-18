import UIKit

/// View controller shown during authentication
final class AuthenticatingViewController: UIViewController {
    
    // MARK: - UI Components
    
    private lazy var containerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()
    
    private lazy var activityIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.color = .systemBlue
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()
    
    private lazy var titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Authenticating"
        label.font = SG.sans(28, .bold)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Verifying your identity..."
        label.font = SG.sans(18, .medium)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private lazy var progressView: UIProgressView = {
        let progress = UIProgressView(progressViewStyle: .default)
        progress.progressTintColor = .systemBlue
        progress.trackTintColor = .systemGray5
        progress.translatesAutoresizingMaskIntoConstraints = false
        return progress
    }()
    
    private lazy var stepLabel: UILabel = {
        let label = UILabel()
        label.font = SG.sans(14, .regular)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .tertiaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()
    
    private let authenticationSteps = [
        "Validating badge...",
        "Contacting authentication server...",
        "Verifying credentials...",
        "Establishing secure session..."
    ]
    
    private var stepIndex = 0
    private var progressTimer: Timer?
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startAnimation()
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopAnimation()
    }
    
    deinit {
        progressTimer?.invalidate()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        view.addSubview(containerView)
        containerView.addSubview(activityIndicator)
        containerView.addSubview(titleLabel)
        containerView.addSubview(statusLabel)
        containerView.addSubview(progressView)
        containerView.addSubview(stepLabel)
        
        NSLayoutConstraint.activate([
            containerView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),
            
            activityIndicator.topAnchor.constraint(equalTo: containerView.topAnchor),
            activityIndicator.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            
            titleLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 24),
            titleLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            statusLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            progressView.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 32),
            progressView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            
            stepLabel.topAnchor.constraint(equalTo: progressView.bottomAnchor, constant: 24),
            stepLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            stepLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            stepLabel.bottomAnchor.constraint(equalTo: containerView.bottomAnchor)
        ])
        
        progressView.progress = 0
        stepLabel.text = authenticationSteps.first
    }
    
    // MARK: - Animation
    
    private func startAnimation() {
        activityIndicator.startAnimating()
        
        let totalDuration: TimeInterval = 4.0
        let stepDuration = totalDuration / Double(authenticationSteps.count)
        
        progressTimer = Timer.scheduledTimer(withTimeInterval: stepDuration, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            
            self.stepIndex += 1
            
            if self.stepIndex < self.authenticationSteps.count {
                UIView.animate(withDuration: 0.2) {
                    self.stepLabel.alpha = 0
                } completion: { _ in
                    self.stepLabel.text = self.authenticationSteps[self.stepIndex]
                    UIView.animate(withDuration: 0.2) {
                        self.stepLabel.alpha = 1
                    }
                }
                
                let progress = Float(self.stepIndex + 1) / Float(self.authenticationSteps.count)
                self.progressView.setProgress(progress, animated: true)
            } else {
                timer.invalidate()
            }
        }
    }
    
    private func stopAnimation() {
        activityIndicator.stopAnimating()
        progressTimer?.invalidate()
    }
}
