import {
    CheckIcon,
    CloseIcon,
    CopyIcon,
    DockIcon,
    PlusIcon,
    SidebarBookIcon as BookIcon,
    TrashIcon,
} from '../icons/icons';

export { BookIcon, CheckIcon, CloseIcon, CopyIcon, DockIcon, PlusIcon, TrashIcon };

export const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
);

// Minimalist AI Logo Icon - abstract neural network design
export const AILogoIcon = ({ size = 20 }: { size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="ai-logo-icon"
    >
        {/* Central brain/network node */}
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.9" />

        {/* Orbital rings - representing AI processing */}
        <ellipse
            cx="12"
            cy="12"
            rx="8"
            ry="4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
        />
        <ellipse
            cx="12"
            cy="12"
            rx="8"
            ry="4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
            transform="rotate(60 12 12)"
        />
        <ellipse
            cx="12"
            cy="12"
            rx="8"
            ry="4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
            transform="rotate(120 12 12)"
        />

        {/* Outer accent dots */}
        <circle cx="4" cy="12" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="20" cy="12" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="12" cy="4" r="1.5" fill="currentColor" opacity="0.7" />
        <circle cx="12" cy="20" r="1.5" fill="currentColor" opacity="0.7" />
    </svg>
);

export const QuoteIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
    </svg>
);

export const BrainIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588 4 4 0 0 0 7.636 2.106 3.2 3.2 0 0 0 .588-.049 3.2 3.2 0 0 0 .588.049 4 4 0 0 0 7.636-2.106 4 4 0 0 0 .556-6.588 4 4 0 0 0-2.526-5.77A3 3 0 1 0 12 5Z" />
        <path d="M12 5v14" />
        <path d="M8 10h8" />
        <path d="M9 14h6" />
    </svg>
);

export const FastRabbitIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 8c0-2.2 1.8-4 4-4 1.1 0 2.1.45 2.8 1.2" />
        <path d="M13.8 5.2 16 3l1 2.5" />
        <path d="M8 14c-2.2 0-4 1.3-4 3s1.8 3 4 3h8c2.2 0 4-1.3 4-3s-1.8-3-4-3" />
        <circle cx="9.5" cy="10" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10" r="0.75" fill="currentColor" stroke="none" />
        <path d="M10 12.5c.6.4 1.3.6 2 .6s1.4-.2 2-.6" />
    </svg>
);

export const ChevronDownIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

export const ChevronUpIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 15 12 9 18 15" />
    </svg>
);

export const StopIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
);
