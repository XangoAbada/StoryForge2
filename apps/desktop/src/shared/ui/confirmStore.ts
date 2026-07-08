import { create } from "zustand";

export type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmState = {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
  open: (request: ConfirmRequest, resolve: (ok: boolean) => void) => void;
  settle: (ok: boolean) => void;
};

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (request, resolve) => set({ request: { ...request, resolve } }),
  settle: (ok) => {
    get().request?.resolve(ok);
    set({ request: null });
  }
}));

/** Promise-owy zamiennik window.confirm — host: <ConfirmHost/> w main.tsx. */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open(request, resolve);
  });
}
