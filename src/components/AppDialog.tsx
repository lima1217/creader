import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { ToastViewport, useToast } from '@astryxdesign/core/Toast';
import './AppDialog.css';

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
 * `confirm()` shows a blocking dialog (focus trap, Escape cancels,
 * initial focus on the cancel button) and resolves with the user's choice.
 *
 * `notice()` shows a non-blocking Astryx toast (auto-dismiss for info, sticky
 * for error) via `useToast`. It does not steal focus.
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
                <Dialog
                    className="app-confirm-dialog"
                    isOpen={isOpen}
                    onOpenChange={(open) => { if (!open) close(false); }}
                    width={400}
                    purpose="form"
                    role="alertdialog"
                >
                    <Layout height="auto" className="app-confirm-dialog-layout">
                        <DialogHeader
                            className="app-confirm-dialog-header"
                            title={dialog.title}
                            subtitle={dialog.message}
                            hasDivider={false}
                        />
                        <LayoutContent className="app-confirm-dialog-content">
                            <div className="app-confirm-dialog-actions">
                                <Button
                                    variant="secondary"
                                    label={dialog.cancelLabel ?? '取消'}
                                    onClick={() => close(false)}
                                />
                                <Button
                                    variant={dialog.tone === 'danger' ? 'destructive' : 'primary'}
                                    label={dialog.confirmLabel ?? '确认'}
                                    onClick={onAction}
                                />
                            </div>
                        </LayoutContent>
                    </Layout>
                </Dialog>
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
