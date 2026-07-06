import { useMemo } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { ChatSendButton } from '@astryxdesign/core/Chat';
import type { AIProviderStatus } from '../../types';
import { BrainIcon, FastRabbitIcon, SendIcon, StopIcon } from './icons';

type AIComposerControlsProps = {
    providers: AIProviderStatus[];
    isLoading: boolean;
    canSend: boolean;
    thinkingEnabled: boolean;
    onThinkingEnabledChange: (enabled: boolean) => void;
    onSelectProvider: (providerId: string) => void;
    onSend: () => void;
    onStop: () => void;
};

function truncateModelLabel(model: string, maxLength = 14): string {
    if (model.length <= maxLength) return model;
    return `${model.slice(0, maxLength - 1)}…`;
}

export function AIComposerControls({
    providers,
    isLoading,
    canSend,
    thinkingEnabled,
    onThinkingEnabledChange,
    onSelectProvider,
    onSend,
    onStop,
}: AIComposerControlsProps) {
    const readyProviders = useMemo(
        () => providers.filter((provider) => provider.hasKey),
        [providers],
    );

    const activeProvider = useMemo(
        () => readyProviders.find((provider) => provider.active) ?? readyProviders[0] ?? null,
        [readyProviders],
    );

    const modelItems = useMemo(
        () => readyProviders.map((provider) => ({
            label: provider.name !== provider.model
                ? `${provider.model} · ${provider.name}`
                : provider.model,
            onClick: () => onSelectProvider(provider.id),
        })),
        [onSelectProvider, readyProviders],
    );

    const modelLabel = activeProvider?.model ?? '无模型';
    const modelMenuDisabled = isLoading || readyProviders.length === 0;
    const modeDisabled = isLoading || !activeProvider;
    const modeLabel = thinkingEnabled ? 'Think' : 'Fast';

    return (
        <div className="ai-composer-actions">
            <DropdownMenu
                hasChevron
                button={{
                    className: 'ai-composer-model-trigger',
                    variant: 'ghost',
                    size: 'sm',
                    label: truncateModelLabel(modelLabel),
                    isDisabled: modelMenuDisabled,
                }}
                menuWidth="min(240px, 70vw)"
                items={modelItems.length > 0 ? modelItems : [{ label: '请先在设置中配置 API', isDisabled: true }]}
            />

            <DropdownMenu
                className="ai-composer-mode-menu"
                hasChevron
                button={{
                    className: 'ai-composer-mode-trigger',
                    variant: 'ghost',
                    size: 'sm',
                    label: modeLabel,
                    isDisabled: modeDisabled,
                }}
                menuWidth={220}
            >
                <DropdownMenuItem
                    label="Think"
                    description="深度思考"
                    icon={<BrainIcon />}
                    onClick={() => onThinkingEnabledChange(true)}
                />
                <DropdownMenuItem
                    label="Fast"
                    description="快速回复"
                    icon={<FastRabbitIcon />}
                    onClick={() => onThinkingEnabledChange(false)}
                />
            </DropdownMenu>

            <ChatSendButton
                isStopShown={isLoading}
                isDisabled={!isLoading && !canSend}
                onSend={onSend}
                onStop={onStop}
                sendIcon={<SendIcon />}
                stopIcon={<StopIcon />}
            />
        </div>
    );
}
