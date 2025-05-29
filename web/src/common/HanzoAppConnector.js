import copy from "copy-to-clipboard";
import * as Setting from "../Setting";
import i18next from "i18next";

export const generateHanzoAppUrl = (accessToken, forQrCode = true) => {
  let qrUrl = "";
  let error = null;

  if (!accessToken) {
    error = i18next.t("general:Access token is empty");
    return {qrUrl, error};
  }

  qrUrl = `casdoor-authenticator://login?serverUrl=${window.location.origin}&accessToken=${accessToken}`;

  if (forQrCode && qrUrl.length >= 2000) {
    qrUrl = "";
    error = i18next.t("general:QR code is too large");
  }

  return {qrUrl, error};
};

export const HanzoAppQrCode = ({accessToken, icon}) => {
  const {qrUrl, error} = generateHanzoAppUrl(accessToken, true);

  if (error) {
    return <Alert message={error} type="error" showIcon />;
  }

  return (
    <QRCode
      value={qrUrl}
      icon={icon}
      errorLevel="M"
      size={230}
      bordered={false}
    />
  );
};

export const HanzoAppUrl = ({accessToken}) => {
  const {qrUrl, error} = generateHanzoAppUrl(accessToken, false);

  const handleCopyUrl = async() => {
    if (!window.isSecureContext) {
      return;
    }

    copy(qrUrl);
    Setting.showMessage("success", i18next.t("general:Copied to clipboard successfully"));
  };

  if (error) {
    return <Alert message={error} type="error" showIcon />;
  }

  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
      }}>
        {window.isSecureContext && (
          <Button size="small" type="primary" onClick={handleCopyUrl} style={{marginLeft: "10px"}}>
            {i18next.t("resource:Copy Link")}
          </Button>
        )}
      </div>
      <div
        style={{
          padding: "10px",
          maxWidth: "400px",
          maxHeight: "100px",
          overflow: "auto",
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
          cursor: "pointer",
          userSelect: "all",
          backgroundColor: "#f5f5f5",
          borderRadius: "4px",
        }}
        onClick={(e) => {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(e.target);
          selection.removeAllRanges();
          selection.addRange(range);
        }}
      >
        {qrUrl}
      </div>
    </div>
  );
};
