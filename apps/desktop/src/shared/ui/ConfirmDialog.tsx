import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useConfirmStore } from "./confirmStore";

export function ConfirmHost() {
  const { t } = useTranslation();
  const request = useConfirmStore((state) => state.request);
  const settle = useConfirmStore((state) => state.settle);

  if (!request) {
    return null;
  }

  return (
    <Modal
      title={request.title}
      size="sm"
      onClose={() => settle(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(false)}>
            {request.cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={request.danger ? "danger" : "primary"}
            className={request.danger ? "ui-confirm-danger" : undefined}
            onClick={() => settle(true)}
          >
            {request.confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      {request.message ? <p className="ui-confirm-message">{request.message}</p> : null}
    </Modal>
  );
}
