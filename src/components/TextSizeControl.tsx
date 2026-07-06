import { NumberStepperControl } from './NumberStepperControl';
import './TextSizeControl.css';

export interface TextSizeControlProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    inputLabel: string;
    decrementAriaLabel: string;
    incrementAriaLabel: string;
    className?: string;
    id?: string;
}

export function TextSizeControl({
    value,
    min,
    max,
    onChange,
    inputLabel,
    decrementAriaLabel,
    incrementAriaLabel,
    className,
    id,
}: TextSizeControlProps) {
    return (
        <NumberStepperControl
            id={id}
            className={className}
            value={value}
            min={min}
            max={max}
            onChange={onChange}
            inputLabel={inputLabel}
            decrementAriaLabel={decrementAriaLabel}
            incrementAriaLabel={incrementAriaLabel}
            decrementLabel="A-"
            incrementLabel="A+"
        />
    );
}
