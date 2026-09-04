type SignupStep = 1 | 2;

const STEPS = [
  { number: 1 as const, label: "Credentials" },
  { number: 2 as const, label: "Authenticator" },
];

export function SignupProgress({ currentStep }: { currentStep: SignupStep }) {
  return (
    <nav aria-label="Account setup progress" className="signup-progress">
      <ol>
        {STEPS.map((step) => {
          const current = step.number === currentStep;
          const complete = step.number < currentStep;
          return (
            <li
              aria-current={current ? "step" : undefined}
              className={current ? "is-current" : complete ? "is-complete" : undefined}
              key={step.number}
            >
              <span aria-hidden="true" className="signup-progress__number">
                {complete ? (
                  <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path
                      d="m5 12 4 4L19 6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : step.number}
              </span>
              <span className="signup-progress__copy">
                <strong>{step.label}</strong>
                <small>{complete ? "Complete" : current ? "Current step" : "Next step"}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
