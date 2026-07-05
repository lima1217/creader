import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
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

function clampTextSize(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
    const adjust = (delta: number) => {
        onChange(clampTextSize(value + delta, min, max));
    };

    return (
        <div
            className={['text-size-control', className].filter(Boolean).join(' ')}
            id={id}
        >
            <Button
                className="text-size-step"
                variant="secondary"
                size="sm"
                label="A-"
                aria-label={decrementAriaLabel}
                onClick={() => adjust(-1)}
                isDisabled={value <= min}
            />
            <NumberInput
                label={inputLabel}
                isLabelHidden
                value={value}
                onChange={next => onChange(clampTextSize(next, min, max))}
                min={min}
                max={max}
                step={1}
                isIntegerOnly
                size="sm"
            />
            <Button
                className="text-size-step"
                variant="secondary"
                size="sm"
                label="A+"
                aria-label={incrementAriaLabel}
                onClick={() => adjust(1)}
                isDisabled={value >= max}
            />
        </div>
    );
}
