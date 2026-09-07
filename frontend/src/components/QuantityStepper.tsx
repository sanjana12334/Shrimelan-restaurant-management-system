interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}

export function QuantityStepper({ value, onChange, min = 1, max = 20 }: QuantityStepperProps) {
  return (
    <div className="qty-stepper">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease quantity">
        −
      </button>
      <span className="qty-value">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}
