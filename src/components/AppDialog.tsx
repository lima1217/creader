import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

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

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const resolverRef = useRef<((value: boolean) => void) | null>(null);

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
        resolverRef.current?.(false);
        resolverRef.current = null;
        setDialog({ kind: 'notice', ...options });
    }, []);

    const value = useMemo(() => ({ confirm, notice }), [confirm, notice]);

    return (
        <AppDialogContext.Provider value={value}>
            {children}
            {dialog && (
                <div className="app-dialog-overlay" role="presentation" onMouseDown={() => close(false)}>
                    <div
                        className="app-dialog"
                        role={dialog.kind === 'confirm' ? 'alertdialog' : 'dialog'}
                        aria-modal="true"
                        aria-labelledby="app-dialog-title"
                        aria-describedby="app-dialog-message"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <h2 id="app-dialog-title">{dialog.title}</h2>
                        <p id="app-dialog-message">{dialog.message}</p>
                        <div className="app-dialog-actions">
                            {dialog.kind === 'confirm' && (
                                <button className="btn btn-ghost" onClick={() => close(false)}>
                                    {dialog.cancelLabel ?? '取消'}
                                </button>
                            )}
                            <button
                                className={`btn ${dialog.kind === 'confirm' && dialog.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => close(dialog.kind === 'confirm')}
                            >
                                {dialog.kind === 'confirm' ? (dialog.confirmLabel ?? '确认') : '知道了'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AppDialogContext.Provider>
    );
}

export function useAppDialog() {
    const context = useContext(AppDialogContext);
    if (!context) throw new Error('useAppDialog must be used within AppDialogProvider');
    return context;
}
