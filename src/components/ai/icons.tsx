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

export const ExplainIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

export const DeconstructIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
    </svg>
);

export const InferenceIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="5" r="3" />
        <circle cx="6" cy="19" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="12" y1="8" x2="6" y2="16" />
        <line x1="12" y1="8" x2="18" y2="16" />
    </svg>
);

export const TranslateIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
    </svg>
);
