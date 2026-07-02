import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { ToastViewport, useToast } from '@astryxdesign/core/Toast';

type ConfirmOptions = {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'normal' | 'danger';
};

type NoticeOptions = {
    title: string;
    message: string;
};

type DialogState =
    | ({ kind: 'confirm' } & ConfirmOptions)
    | ({ kind: 'notice' } & NoticeOptions);

type DialogContextValue = {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    notice: (options: NoticeOptions) => void;
};

const AppDialogContext = createContext<DialogContextValue | null>(null);

/**
 * Global dialog + toast provider.
 *
 * `confirm()` shows a blocking Astryx AlertDialog (focus trap, Escape cancels,
 * initial focus on the cancel button) and resolves with the user's choice —
 * the Promise API is unchanged from the bespoke-overlay era so call sites need
 * no edits.
 *
 * `notice()` shows a non-blocking Astryx toast (auto-dismiss for info, sticky
 * for error) via `useToast`. It does not steal focus, matching the
 * "non-blocking notices as toasts" intent. The Promise/void contract is
 * preserved; no call-site edits required.
 */
export function AppDialogProvider({ children }: { children: React.ReactNode }) {
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const resolverRef = useRef<((value: boolean) => void) | null>(null);
    const toast = useToast();

    const close = useCallback((value: boolean) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setDialog(null);
        if (resolve) resolve(value);
    }, []);

    const confirm = useCallback((options: ConfirmOptions) => {
        resolverRef.current?.(false);
        setDialog({ kind: 'confirm', ...options });
        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
        });
    }, []);

    const notice = useCallback((options: NoticeOptions) => {
        const body = options.title ? `${options.title}：${options.message}` : options.message;
        toast({
            body,
            type: 'error',
            // Error toasts stay until dismissed (Astryx default for error), so
            // import failures are not missed while never blocking the reader.
        });
    }, [toast]);

    const value = useMemo(() => ({ confirm, notice }), [confirm, notice]);

    const isOpen = dialog !== null;
    const isConfirm = dialog?.kind === 'confirm';
    const onAction = useCallback(() => {
        close(isConfirm);
    }, [close, isConfirm]);

    return (
        <AppDialogContext.Provider value={value}>
            {children}
            {isConfirm && dialog && (
                <AlertDialog
                    isOpen={isOpen}
                    onOpenChange={(open) => { if (!open) close(false); }}
                    title={dialog.title}
                    description={dialog.message}
                    cancelLabel={dialog.cancelLabel ?? '取消'}
                    actionLabel={dialog.confirmLabel ?? '确认'}
                    actionVariant={dialog.tone === 'danger' ? 'destructive' : 'primary'}
                    onAction={onAction}
                    width={440}
                />
            )}
            <ToastViewport position="bottomEnd" maxVisible={3} />
        </AppDialogContext.Provider>
    );
}

export function useAppDialog() {
    const context = useContext(AppDialogContext);
    if (!context) throw new Error('useAppDialog must be used within AppDialogProvider');
    return context;
}
