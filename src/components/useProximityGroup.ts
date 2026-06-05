import { useEffect, useRef } from 'react';

type ProximityOptions = {
    selector?: string;
    radius?: number;
    maxScale?: number;
    minOpacity?: number;
};

const DEFAULT_SELECTOR = '[data-proximity-control]';

export function useProximityGroup<T extends HTMLElement>({
    selector = DEFAULT_SELECTOR,
    radius = 120,
    maxScale = 0.1,
    minOpacity = 0.74,
}: ProximityOptions = {}) {
    const groupRef = useRef<T>(null);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        const controls = () => Array.from(group.querySelectorAll<HTMLElement>(selector));

        const reset = () => {
            controls().forEach(control => {
                control.style.removeProperty('scale');
                control.style.removeProperty('opacity');
            });
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (reducedMotion.matches) {
                reset();
                return;
            }

            controls().forEach(control => {
                if (control.matches(':disabled')) {
                    control.style.removeProperty('scale');
                    control.style.removeProperty('opacity');
                    return;
                }

                const rect = control.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
                const influence = Math.max(0, 1 - distance / radius);

                control.style.scale = String(1 + influence * maxScale);
                control.style.opacity = String(minOpacity + influence * (1 - minOpacity));
            });
        };

        group.addEventListener('pointermove', handlePointerMove);
        group.addEventListener('pointerleave', reset);
        reducedMotion.addEventListener('change', reset);

        return () => {
            group.removeEventListener('pointermove', handlePointerMove);
            group.removeEventListener('pointerleave', reset);
            reducedMotion.removeEventListener('change', reset);
            reset();
        };
    }, [maxScale, minOpacity, radius, selector]);

    return groupRef;
}
